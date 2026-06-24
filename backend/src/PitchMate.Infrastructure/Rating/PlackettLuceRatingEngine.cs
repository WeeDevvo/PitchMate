using PitchMate.Domain.Rating;

// Declared in the flat PitchMate.Infrastructure namespace (not PitchMate.Infrastructure.Rating)
// so the Domain "Rating" value type is not shadowed by a same-named namespace anywhere in the
// Infrastructure assembly tree (which would break the property-test generators). The file still
// lives in the Rating/ folder for organisation.
namespace PitchMate.Infrastructure;

/// <summary>
/// OpenSkill PlackettLuce implementation of <see cref="IRatingEngine"/>. Pure and deterministic:
/// no persistence, clock, randomness, or I/O. All model parameters come from an injected
/// <see cref="RatingEngineConfig"/>.
/// </summary>
/// <remarks>
/// The engine holds no mutable state, so a single instance is safe to register as a singleton.
/// On construction it computes and caches a configuration-validation <see cref="Result{T}"/>; when
/// the configuration is invalid, every operation returns the cached
/// <see cref="RatingErrorCode.InvalidConfiguration"/> error and performs no rating computation
/// (Requirements 11.5, 12.6). The math operations are stubbed at this stage and filled in by later tasks.
/// </remarks>
public sealed class PlackettLuceRatingEngine : IRatingEngine
{
    private readonly RatingEngineConfig _config;

    /// <summary>
    /// The cached configuration error, or <c>null</c> when the injected configuration is valid.
    /// Computed once at construction so all operations can gate on it without recomputation.
    /// </summary>
    private readonly RatingError? _configError;

    /// <summary>
    /// Constructs the engine and validates the supplied configuration, caching the result.
    /// Construction never throws for invalid configuration; the error is surfaced through every
    /// operation instead.
    /// </summary>
    /// <param name="config">The injected model parameters.</param>
    public PlackettLuceRatingEngine(RatingEngineConfig config)
    {
        _config = config;
        _configError = ValidateConfig(config);
    }

    /// <inheritdoc />
    public Result<Rating> CreateRating(SkillTier? tier = null)
    {
        if (_configError is not null)
        {
            return Result<Rating>.Fail(_configError);
        }

        // σ is the configured initial uncertainty for every tier (and for an unseeded player), so a
        // cold-start rating always starts uncertain and converges from real results (Requirement 8.2).
        // μ is seeded from the tier's configured mean, or the default mean when no tier is supplied
        // (Requirements 1.2, 8.1, 8.5). The tier means are guaranteed strictly ordered by config
        // validation, so Strong > Average > Beginner holds (Requirement 8.3).
        double mu;
        switch (tier)
        {
            case null:
                mu = _config.DefaultMean;
                break;
            case SkillTier.Beginner:
                mu = _config.BeginnerMean;
                break;
            case SkillTier.Average:
                mu = _config.AverageMean;
                break;
            case SkillTier.Strong:
                mu = _config.StrongMean;
                break;
            default:
                // An undefined enum value (e.g. cast from an out-of-range integer) is unrecognized:
                // return an error and no rating (Requirement 8.6).
                return Result<Rating>.Fail(new RatingError(
                    RatingErrorCode.UnknownSkillTier,
                    $"Skill tier '{tier}' is not one of Beginner, Average, or Strong."));
        }

        return Result<Rating>.Ok(new Rating(mu, _config.InitialUncertainty));
    }

    /// <inheritdoc />
    public Result<RatingState> GetState(Rating rating)
    {
        if (_configError is not null)
        {
            return Result<RatingState>.Fail(_configError);
        }

        // σ strictly greater than the configured provisional threshold => Provisional; σ less than or
        // equal to the threshold (including σ = 0) => Established (Requirements 1.3, 1.4, 1.5). The
        // comparison is exhaustive, so exactly one state is always returned (Requirement 1.6).
        var state = rating.Sigma > _config.ProvisionalThreshold
            ? RatingState.Provisional
            : RatingState.Established;

        return Result<RatingState>.Ok(state);
    }

    /// <inheritdoc />
    public Result<MatchUpdate> UpdateRatings(MatchOutcome outcome)
    {
        if (_configError is not null)
        {
            return Result<MatchUpdate>.Fail(_configError);
        }

        // Validation-first: every input is checked before any rating computation (Requirement 12.6).
        // On any failure the engine returns the error and performs no computation, so the immutable
        // input records are provably left unchanged (Requirement 12.7).
        var validationError = ValidateMatchOutcome(outcome);
        if (validationError is not null)
        {
            return Result<MatchUpdate>.Fail(validationError);
        }

        // Lever-specific validation runs after the per-rating/structure checks and only when the lever
        // is enabled: with margin-of-victory weighting disabled the goal margin is ignored entirely, so
        // a negative margin must not be rejected (Requirements 6.2, 6.6). When disabled the goal margin
        // never participates in the computation, keeping the disabled path bit-identical to supplying no
        // margin (Property 13).
        if (_config.MarginOfVictoryWeightingEnabled)
        {
            var marginError = ValidateGoalMargin(outcome.GoalMargin);
            if (marginError is not null)
            {
                return Result<MatchUpdate>.Fail(marginError);
            }
        }

        // Participation is consulted only when its lever is enabled. With participation weighting
        // disabled the participation values are ignored entirely, so a missing or out-of-range value
        // must not be rejected and the update is independent of any participation supplied
        // (Requirements 7.2, 7.6). When enabled, every player must carry a finite participation value in
        // the inclusive range [0, 1] before any computation runs (Requirement 7.6).
        if (_config.ParticipationWeightingEnabled)
        {
            var participationError = ValidateParticipation(outcome);
            if (participationError is not null)
            {
                return Result<MatchUpdate>.Fail(participationError);
            }
        }

        var update = ComputePlackettLuce(outcome);

        // Apply the margin-of-victory lever to the base update when enabled and a margin is supplied.
        // A null or zero margin yields a multiplier of 1.0, so the result equals the disabled update
        // (Requirements 6.2, 6.5).
        if (_config.MarginOfVictoryWeightingEnabled && outcome.GoalMargin is int goalMargin)
        {
            update = ApplyMarginOfVictory(outcome, update, goalMargin);
        }

        // Apply the participation lever after the margin lever so the two compose: participation
        // interpolates each player's (possibly margin-adjusted) update back toward their input rating
        // by their participation value p (Requirements 7.3, 7.4, 7.5).
        if (_config.ParticipationWeightingEnabled)
        {
            update = ApplyParticipation(outcome, update);
        }

        return Result<MatchUpdate>.Ok(update);
    }

    /// <inheritdoc />
    public Result<IReadOnlyList<Rating>> Replay(
        IReadOnlyList<Rating> initialRatings,
        IReadOnlyList<ReplayMatch> matches)
    {
        if (_configError is not null)
        {
            return Result<IReadOnlyList<Rating>>.Fail(_configError);
        }

        // Validation-first: every replay-specific input is checked before any rating computation
        // (Requirement 12.6). Each participant references a player by an opaque index into the initial
        // rating list, so every index across every match must fall within range before the fold begins.
        // On failure the engine returns the error and performs no computation, leaving the inputs
        // unchanged (Requirements 5.x, 12.7).
        var indexError = ValidatePlayerIndices(initialRatings, matches);
        if (indexError is not null)
        {
            return Result<IReadOnlyList<Rating>>.Fail(indexError);
        }

        // Replay is a pure fold over the single UpdateRatings operation (Requirement 5.3): the first
        // match consumes the initial ratings and each subsequent match consumes the prior match's
        // outputs (Requirements 5.1, 5.2). The working copy is threaded by opaque player index; the
        // caller's input list and Rating values are never mutated (Requirement 4.3). An empty sequence
        // performs no update and returns the initial ratings unchanged (Requirement 5.5).
        var current = initialRatings.ToArray();

        for (var matchIndex = 0; matchIndex < matches.Count; matchIndex++)
        {
            var match = matches[matchIndex];

            // Map the opaque player indices to their current threaded ratings, building a MatchOutcome
            // that drives the same UpdateRatings code path used by single match-completion. This is what
            // guarantees single-completion and replay are consistent (Requirement 5.4).
            var outcome = BuildOutcome(current, match);

            var updateResult = UpdateRatings(outcome);
            if (!updateResult.IsSuccess)
            {
                // Propagate the first computation error. Only the local working copy has been mutated,
                // so the caller's initial ratings are left unchanged (Requirement 12.7).
                return Result<IReadOnlyList<Rating>>.Fail(updateResult.Error!);
            }

            // Write the updated ratings back to the threaded list by player index before processing the
            // next match, so subsequent matches consume these outputs (Requirements 5.1, 5.2).
            var updatedTeams = updateResult.Value!.Teams;
            for (var teamIndex = 0; teamIndex < match.Teams.Count; teamIndex++)
            {
                var participants = match.Teams[teamIndex].Participants;
                var updatedTeam = updatedTeams[teamIndex];
                for (var playerIndex = 0; playerIndex < participants.Count; playerIndex++)
                {
                    current[participants[playerIndex].PlayerIndex] = updatedTeam[playerIndex];
                }
            }
        }

        return Result<IReadOnlyList<Rating>>.Ok(current);
    }

    /// <summary>
    /// Builds a <see cref="MatchOutcome"/> for one <see cref="ReplayMatch"/> by resolving each
    /// participant's opaque player index against the current threaded ratings. Team and participant
    /// ordering, ranks, the per-participant participation value, and the match goal margin are carried
    /// through unchanged so the resulting outcome drives the identical <see cref="UpdateRatings"/> path.
    /// </summary>
    private static MatchOutcome BuildOutcome(IReadOnlyList<Rating> current, ReplayMatch match)
    {
        var teams = new TeamResult[match.Teams.Count];
        for (var teamIndex = 0; teamIndex < match.Teams.Count; teamIndex++)
        {
            var replayTeam = match.Teams[teamIndex];
            var players = new PlayerInput[replayTeam.Participants.Count];
            for (var playerIndex = 0; playerIndex < replayTeam.Participants.Count; playerIndex++)
            {
                var participant = replayTeam.Participants[playerIndex];
                players[playerIndex] = new PlayerInput(current[participant.PlayerIndex], participant.Participation);
            }

            teams[teamIndex] = new TeamResult(players, replayTeam.Rank);
        }

        return new MatchOutcome(teams, match.GoalMargin);
    }

    /// <summary>
    /// Validates that every <see cref="ReplayParticipant.PlayerIndex"/> across every match falls within
    /// the bounds of <paramref name="initialRatings"/>, returning a
    /// <see cref="RatingErrorCode.InvalidPlayerIndex"/> error for the first out-of-range index or
    /// <c>null</c> when all indices are valid. Runs before the fold so no rating computation occurs on a
    /// malformed replay and the inputs are left unchanged.
    /// </summary>
    private static RatingError? ValidatePlayerIndices(
        IReadOnlyList<Rating> initialRatings,
        IReadOnlyList<ReplayMatch> matches)
    {
        var ratingCount = initialRatings.Count;

        for (var matchIndex = 0; matchIndex < matches.Count; matchIndex++)
        {
            var teams = matches[matchIndex].Teams;
            for (var teamIndex = 0; teamIndex < teams.Count; teamIndex++)
            {
                var participants = teams[teamIndex].Participants;
                for (var playerIndex = 0; playerIndex < participants.Count; playerIndex++)
                {
                    var index = participants[playerIndex].PlayerIndex;
                    if (index < 0 || index >= ratingCount)
                    {
                        return new RatingError(
                            RatingErrorCode.InvalidPlayerIndex,
                            $"Participant {playerIndex} on team {teamIndex} of match {matchIndex} " +
                            $"references player index {index}, which is out of range of the " +
                            $"{ratingCount} initial rating(s).");
                    }
                }
            }
        }

        return null;
    }

    /// <inheritdoc />
    public Result<Rating> DecayInactivity(Rating rating, int inactiveDays)
    {
        if (_configError is not null)
        {
            return Result<Rating>.Fail(_configError);
        }

        // Validation-first: a negative inactivity duration is rejected before any computation, leaving
        // the immutable input rating unchanged (Requirements 9.7, 12.6, 12.7).
        if (inactiveDays < 0)
        {
            return Result<Rating>.Fail(new RatingError(
                RatingErrorCode.NegativeDuration,
                $"The inactivity duration must not be negative but was {inactiveDays} day(s)."));
        }

        var initialUncertainty = _config.InitialUncertainty;

        // An already-high σ is never inflated: when the input σ already exceeds the configured initial
        // uncertainty, return it unchanged (Requirement 9.4). μ is always preserved (Requirement 9.2).
        if (rating.Sigma > initialUncertainty)
        {
            return Result<Rating>.Ok(rating);
        }

        // Within the decay-free period σ is left untouched (Requirement 9.5). Durations are whole days,
        // and only the days strictly beyond the free period contribute decay, so a longer duration never
        // yields a smaller σ than a shorter one (Requirement 9.6).
        var daysPastFreePeriod = inactiveDays - _config.DecayFreePeriodDays;
        if (daysPastFreePeriod <= 0)
        {
            return Result<Rating>.Ok(rating);
        }

        // Grow the variance linearly with the days past the free period (DecayRate is variance growth per
        // day), then bound the result so σ never exceeds the configured initial uncertainty
        // (Requirements 9.1, 9.3). Working in variance keeps the growth monotonic in whole days.
        var initialVariance = initialUncertainty * initialUncertainty;
        var grownVariance = rating.Sigma * rating.Sigma + _config.DecayRate * daysPastFreePeriod;
        var boundedVariance = Math.Min(grownVariance, initialVariance);

        // Guard against any floating-point overshoot below the input σ so the returned σ is always
        // greater than or equal to the input σ (Requirement 9.1).
        var decayedSigma = Math.Max(Math.Sqrt(boundedVariance), rating.Sigma);

        return Result<Rating>.Ok(rating with { Sigma = decayedSigma });
    }

    /// <inheritdoc />
    public Result<MatchPrediction> Predict(IReadOnlyList<TeamRoster> rosters)
    {
        if (_configError is not null)
        {
            return Result<MatchPrediction>.Fail(_configError);
        }

        // Validation-first: structural checks (two or more non-empty rosters) then per-rating values
        // (finite μ/σ, σ > 0), all before any prediction computation (Requirement 12.6). On failure the
        // engine returns the error and computes nothing, so the immutable input rosters and ratings are
        // provably left unchanged and no probabilities are returned (Requirements 10.7, 12.7).
        var validationError = ValidateRosters(rosters);
        if (validationError is not null)
        {
            return Result<MatchPrediction>.Fail(validationError);
        }

        // Win probabilities use both μ and σ of every roster and are normalised to sum to 1.0
        // (Requirements 10.2, 10.3, 10.4). The draw probability is computed independently and is not
        // part of that sum (Requirements 10.2, 10.6).
        var winProbabilities = ComputePredictWin(rosters);
        var drawProbability = ComputePredictDraw(rosters);

        return Result<MatchPrediction>.Ok(new MatchPrediction(winProbabilities, drawProbability));
    }

    /// <summary>
    /// A tiny positive floor on the σ variance-reduction factor. Keeps σ strictly above zero even at
    /// extreme inputs (Requirement 2.6) and prevents the posterior variance from collapsing to a
    /// non-positive value. Matches the canonical openskill.py PlackettLuce default (κ).
    /// </summary>
    private const double Kappa = 0.0001;

    /// <summary>
    /// Computes the base OpenSkill PlackettLuce update over <paramref name="outcome"/>'s N ranked teams,
    /// ported from the reference openskill.py implementation (Weng &amp; Lin, 2011, Algorithm 4). The
    /// outcome is assumed already validated. The dynamics factor τ is intentionally excluded from this
    /// path so σ is only ever reduced (Requirement 2.5), and the margin-of-victory / participation
    /// levers are no-ops here (they are wired in a later task). Team and player input ordering is
    /// preserved in the returned <see cref="MatchUpdate"/> (Requirement 2.4).
    /// </summary>
    /// <remarks>
    /// For each team <c>i</c>: μᵢ = Σ player μ, σ²ᵢ = Σ player σ². The match-wide normaliser is
    /// <c>c = sqrt( Σ_teams (σ²ᵢ + β²) )</c>. Per team the PlackettLuce normaliser is
    /// <c>sumQ[q] = Σ_{i : rankᵢ ≥ rank_q} exp(μᵢ / c)</c> and <c>a[q]</c> is the number of teams sharing
    /// team q's rank (tie count). The mean-shift Ωᵢ and variance-reduction Δᵢ accumulate over every team
    /// ranked at least as well as team i; tied teams contribute symmetrically, giving first-class draws
    /// (Requirement 3.2). Per player j in team i: μ′ = μ + (σ²ⱼ / σ²ᵢ)·Ωᵢ and
    /// σ′ = σ·sqrt(max(1 − (σ²ⱼ / σ²ᵢ)·Δᵢ, κ)). Finally, teams sharing a rank have their μ change
    /// equalised across the tied group so no winner/loser ordering is imposed (Requirements 3.2, 3.3).
    /// </remarks>
    private MatchUpdate ComputePlackettLuce(MatchOutcome outcome)
    {
        var teams = outcome.Teams;
        var teamCount = teams.Count;
        var betaSquared = _config.Beta * _config.Beta;

        // Per-team aggregates (preserving input order) and the match-wide collective variance.
        var teamMu = new double[teamCount];
        var teamSigmaSquared = new double[teamCount];
        var ranks = new int[teamCount];
        var collectiveSigma = 0.0;
        for (var i = 0; i < teamCount; i++)
        {
            var players = teams[i].Players;
            var muSum = 0.0;
            var sigmaSquaredSum = 0.0;
            for (var j = 0; j < players.Count; j++)
            {
                var rating = players[j].Rating;
                muSum += rating.Mu;
                sigmaSquaredSum += rating.Sigma * rating.Sigma;
            }

            teamMu[i] = muSum;
            teamSigmaSquared[i] = sigmaSquaredSum;
            ranks[i] = teams[i].Rank;

            // c² sums one β² per team alongside the team variance (Weng-Lin Algorithm 4 / openskill.py).
            collectiveSigma += sigmaSquaredSum + betaSquared;
        }

        var c = Math.Sqrt(collectiveSigma);

        // exp(μᵢ / c) per team, reused for both the normaliser and the per-team accumulation.
        var expMuOverC = new double[teamCount];
        for (var i = 0; i < teamCount; i++)
        {
            expMuOverC[i] = Math.Exp(teamMu[i] / c);
        }

        // sumQ[q] = Σ_{i : rankᵢ ≥ rank_q} exp(μᵢ / c); tieCount[q] = |{ i : rankᵢ = rank_q }|.
        var sumQ = new double[teamCount];
        var tieCount = new int[teamCount];
        for (var q = 0; q < teamCount; q++)
        {
            var summed = 0.0;
            var ties = 0;
            for (var i = 0; i < teamCount; i++)
            {
                if (ranks[i] >= ranks[q])
                {
                    summed += expMuOverC[i];
                }

                if (ranks[i] == ranks[q])
                {
                    ties++;
                }
            }

            sumQ[q] = summed;
            tieCount[q] = ties;
        }

        var updated = new Rating[teamCount][];

        // The μ change of each team's first player, used to equalise tied teams' μ shift below.
        var firstPlayerMuDelta = new double[teamCount];

        for (var i = 0; i < teamCount; i++)
        {
            var omega = 0.0;
            var delta = 0.0;
            var iExp = expMuOverC[i];

            // Accumulate Ω/Δ over every team ranked at least as well as team i (rank_q ≤ rankᵢ).
            for (var q = 0; q < teamCount; q++)
            {
                if (ranks[q] > ranks[i])
                {
                    continue;
                }

                var quotient = iExp / sumQ[q];
                delta += quotient * (1.0 - quotient) / tieCount[q];
                if (q == i)
                {
                    omega += (1.0 - quotient) / tieCount[q];
                }
                else
                {
                    omega -= quotient / tieCount[q];
                }
            }

            var sigmaSquaredTeam = teamSigmaSquared[i];
            omega *= sigmaSquaredTeam / c;
            delta *= sigmaSquaredTeam / (c * c);
            delta *= Math.Sqrt(sigmaSquaredTeam) / c; // γ factor.

            var players = teams[i].Players;
            var teamOut = new Rating[players.Count];
            for (var j = 0; j < players.Count; j++)
            {
                var rating = players[j].Rating;
                var sigmaSquared = rating.Sigma * rating.Sigma;
                var newMu = rating.Mu + (sigmaSquared / sigmaSquaredTeam) * omega;

                // The κ floor keeps the variance factor positive, so σ stays strictly above zero and
                // never increases (the factor is in (0, 1]).
                var varianceFactor = Math.Max(1.0 - (sigmaSquared / sigmaSquaredTeam) * delta, Kappa);
                var newSigma = rating.Sigma * Math.Sqrt(varianceFactor);

                teamOut[j] = new Rating(newMu, newSigma);
            }

            firstPlayerMuDelta[i] = teamOut[0].Mu - players[0].Rating.Mu;
            updated[i] = teamOut;
        }

        // Draw symmetry: for every group of teams sharing a rank, equalise the μ change across the group
        // (using the per-team first-player delta as the representative shift) so no winner/loser ordering
        // is imposed between tied teams (Requirements 3.2, 3.3). σ is left as computed.
        var rankGroups = new Dictionary<int, List<int>>();
        for (var i = 0; i < teamCount; i++)
        {
            if (!rankGroups.TryGetValue(ranks[i], out var group))
            {
                group = new List<int>();
                rankGroups[ranks[i]] = group;
            }

            group.Add(i);
        }

        foreach (var indices in rankGroups.Values)
        {
            if (indices.Count <= 1)
            {
                continue;
            }

            var averageMuChange = 0.0;
            for (var g = 0; g < indices.Count; g++)
            {
                averageMuChange += firstPlayerMuDelta[indices[g]];
            }

            averageMuChange /= indices.Count;

            for (var g = 0; g < indices.Count; g++)
            {
                var i = indices[g];
                var players = teams[i].Players;
                var teamOut = updated[i];
                for (var j = 0; j < teamOut.Length; j++)
                {
                    teamOut[j] = teamOut[j] with { Mu = players[j].Rating.Mu + averageMuChange };
                }
            }
        }

        var result = new IReadOnlyList<Rating>[teamCount];
        for (var i = 0; i < teamCount; i++)
        {
            result[i] = updated[i];
        }

        return new MatchUpdate(result);
    }

    /// <summary>
    /// Applies the margin-of-victory lever to a base PlackettLuce <paramref name="baseUpdate"/>. The lever
    /// scales each player's mean shift <c>(μ′ − μ)</c> by the concave, capped multiplier
    /// <see cref="MarginMultiplier"/>; σ is left exactly as the base update computed it. The supplied
    /// <paramref name="margin"/> is assumed already validated as non-negative. With a margin of zero the
    /// multiplier is 1.0, so the result is identical to the base update (Requirements 6.3, 6.4, 6.5).
    /// </summary>
    /// <remarks>
    /// Operating on the mean shift relative to the original input μ (rather than re-running the model)
    /// keeps the lever a pure post-transform of the base result, including the draw-equalised μ values,
    /// and leaves the monotonic-σ guarantee untouched.
    /// </remarks>
    private MatchUpdate ApplyMarginOfVictory(MatchOutcome outcome, MatchUpdate baseUpdate, int margin)
    {
        var multiplier = MarginMultiplier(margin);
        var teamCount = baseUpdate.Teams.Count;
        var teams = new IReadOnlyList<Rating>[teamCount];

        for (var i = 0; i < teamCount; i++)
        {
            var inputPlayers = outcome.Teams[i].Players;
            var baseTeam = baseUpdate.Teams[i];
            var teamOut = new Rating[baseTeam.Count];
            for (var j = 0; j < baseTeam.Count; j++)
            {
                var inputMu = inputPlayers[j].Rating.Mu;
                var meanShift = baseTeam[j].Mu - inputMu;
                teamOut[j] = baseTeam[j] with { Mu = inputMu + multiplier * meanShift };
            }

            teams[i] = teamOut;
        }

        return new MatchUpdate(teams);
    }

    /// <summary>
    /// Applies the participation lever to a base update (<paramref name="baseUpdate"/>, already
    /// margin-adjusted when that lever is enabled). Each player's update is linearly interpolated back
    /// toward their input rating by their participation value <c>p ∈ [0, 1]</c>:
    /// <c>μ″ = μ + p·(μ′ − μ)</c> and <c>σ″ = σ + p·(σ′ − σ)</c>, where <c>(μ, σ)</c> is the input rating
    /// and <c>(μ′, σ′)</c> is the base update. Participation is assumed already validated as a finite
    /// value in <c>[0, 1]</c>. With <c>p = 1</c> the result reproduces the base update (Requirement 7.4);
    /// with <c>p = 0</c> the rating is left unchanged (Requirement 7.5); the μ-shift magnitude scales
    /// monotonically with <c>p</c> (Requirement 7.3).
    /// </summary>
    /// <remarks>
    /// Because the base update never increases σ (<c>σ′ ≤ σ</c>), the interpolated <c>σ″</c> lies in
    /// <c>[σ′, σ]</c> and so also satisfies <c>σ″ ≤ σ</c>, preserving the monotonic-σ guarantee.
    /// </remarks>
    private static MatchUpdate ApplyParticipation(MatchOutcome outcome, MatchUpdate baseUpdate)
    {
        var teamCount = baseUpdate.Teams.Count;
        var teams = new IReadOnlyList<Rating>[teamCount];

        for (var i = 0; i < teamCount; i++)
        {
            var inputPlayers = outcome.Teams[i].Players;
            var baseTeam = baseUpdate.Teams[i];
            var teamOut = new Rating[baseTeam.Count];
            for (var j = 0; j < baseTeam.Count; j++)
            {
                var input = inputPlayers[j].Rating;

                // Validation guarantees a finite participation in [0, 1] when this lever is enabled.
                var p = inputPlayers[j].Participation!.Value;

                var newMu = input.Mu + p * (baseTeam[j].Mu - input.Mu);
                var newSigma = input.Sigma + p * (baseTeam[j].Sigma - input.Sigma);
                teamOut[j] = new Rating(newMu, newSigma);
            }

            teams[i] = teamOut;
        }

        return new MatchUpdate(teams);
    }

    /// non-negative goal margin <paramref name="margin"/>. It is non-decreasing in the margin with
    /// diminishing per-goal increments, equals 1.0 at margin zero, and is clamped to the range
    /// <c>[1.0, MarginMultiplierMax)</c> (Requirements 6.3, 6.4, 6.5). For any finite margin ≥ 0 the
    /// term <c>g / (g + 1)</c> lies in <c>[0, 1)</c>, so the formula already stays within the range; the
    /// clamp is a numerical-safety guard.
    /// </summary>
    private double MarginMultiplier(int margin)
    {
        double g = margin;
        var m = 1.0 + (_config.MarginMultiplierMax - 1.0) * g / (g + 1.0);

        // Clamp into [1.0, MarginMultiplierMax]; the formula never reaches the upper bound for a finite
        // margin, so the effective range is [1.0, MarginMultiplierMax).
        if (m < 1.0)
        {
            m = 1.0;
        }
        else if (m > _config.MarginMultiplierMax)
        {
            m = _config.MarginMultiplierMax;
        }

        return m;
    }

    /// <summary>
    /// Validates the goal margin for the margin-of-victory lever, returning a <see cref="RatingError"/>
    /// when it is negative (<see cref="RatingErrorCode.NegativeMargin"/>) or <c>null</c> when it is
    /// absent or non-negative (Requirement 6.6). The margin is modelled as an <see cref="int"/>, so it is
    /// always finite and the <see cref="RatingErrorCode.NonFiniteMargin"/> case cannot arise here.
    /// </summary>
    private static RatingError? ValidateGoalMargin(int? goalMargin)
    {
        if (goalMargin is int margin && margin < 0)
        {
            return new RatingError(
                RatingErrorCode.NegativeMargin,
                $"The goal margin must not be negative but was {margin}.");
        }

        return null;
    }

    /// <summary>
    /// Validates the participation values for the participation lever, returning a
    /// <see cref="RatingError"/> with code <see cref="RatingErrorCode.InvalidParticipation"/> for the
    /// first player whose participation is missing, non-finite, or outside the inclusive range
    /// <c>[0, 1]</c>, or <c>null</c> when every player's participation is valid (Requirement 7.6). Runs
    /// only when the lever is enabled and after the structural / per-rating checks, so a malformed
    /// participation never reaches the computation and the inputs are left unchanged.
    /// </summary>
    private static RatingError? ValidateParticipation(MatchOutcome outcome)
    {
        for (var teamIndex = 0; teamIndex < outcome.Teams.Count; teamIndex++)
        {
            var players = outcome.Teams[teamIndex].Players;
            for (var playerIndex = 0; playerIndex < players.Count; playerIndex++)
            {
                var participation = players[playerIndex].Participation;

                if (participation is not double p)
                {
                    return new RatingError(
                        RatingErrorCode.InvalidParticipation,
                        $"Player {playerIndex} on team {teamIndex} is missing a participation value " +
                        "while participation weighting is enabled.");
                }

                if (!IsFinite(p) || p < 0.0 || p > 1.0)
                {
                    return new RatingError(
                        RatingErrorCode.InvalidParticipation,
                        $"Player {playerIndex} on team {teamIndex} has a participation value of {p}, " +
                        "which must be a finite number in the inclusive range [0, 1].");
                }
            }
        }

        return null;
    }

    /// operation-level structure (team count, empty teams) → per-rating values (finite μ/σ, σ &gt; 0)
    /// → ranks. Returns a <see cref="RatingError"/> describing the first violation found, or
    /// <c>null</c> when the outcome is valid. Performs no rating computation and never mutates the
    /// input (Requirements 12.1, 12.2, 12.3, 12.4, 12.6, 12.7; 3.5 for ranks).
    /// </summary>
    private static RatingError? ValidateMatchOutcome(MatchOutcome outcome)
    {
        // Structure: a match needs two or more teams (Requirement 12.1).
        if (outcome.Teams.Count < 2)
        {
            return new RatingError(
                RatingErrorCode.TooFewTeams,
                $"A match outcome requires at least two teams but contained {outcome.Teams.Count}.");
        }

        // Structure: every team must field at least one player (Requirement 12.2).
        for (var teamIndex = 0; teamIndex < outcome.Teams.Count; teamIndex++)
        {
            if (outcome.Teams[teamIndex].Players.Count == 0)
            {
                return new RatingError(
                    RatingErrorCode.EmptyTeam,
                    $"Team at index {teamIndex} contains no players.");
            }
        }

        // Per-rating values: every player's μ/σ must be finite (Requirement 12.4) and σ strictly
        // positive (Requirement 12.3), checked across all teams before any computation.
        for (var teamIndex = 0; teamIndex < outcome.Teams.Count; teamIndex++)
        {
            var players = outcome.Teams[teamIndex].Players;
            for (var playerIndex = 0; playerIndex < players.Count; playerIndex++)
            {
                var ratingError = ValidateRatingValues(players[playerIndex].Rating, teamIndex, playerIndex);
                if (ratingError is not null)
                {
                    return ratingError;
                }
            }
        }

        // Ranks: a team's finishing rank must be non-negative (Requirement 3.5).
        for (var teamIndex = 0; teamIndex < outcome.Teams.Count; teamIndex++)
        {
            if (outcome.Teams[teamIndex].Rank < 0)
            {
                return new RatingError(
                    RatingErrorCode.NegativeRank,
                    $"Team at index {teamIndex} has a negative rank of {outcome.Teams[teamIndex].Rank}.");
            }
        }

        return null;
    }

    /// <summary>
    /// Validates a single input <see cref="Rating"/>'s numeric values. Finiteness is checked before
    /// positivity so a non-finite σ (NaN/±∞) is reported as <see cref="RatingErrorCode.NonFiniteValue"/>
    /// rather than slipping past the σ &gt; 0 comparison (NaN comparisons are always false). Returns the
    /// first violation found, or <c>null</c> when both μ and σ are valid
    /// (Requirements 12.3, 12.4). The indices are included in the diagnostic message only.
    /// </summary>
    private static RatingError? ValidateRatingValues(Rating rating, int teamIndex, int playerIndex)
    {
        if (!IsFinite(rating.Mu) || !IsFinite(rating.Sigma))
        {
            return new RatingError(
                RatingErrorCode.NonFiniteValue,
                $"Rating for player {playerIndex} on team {teamIndex} has a non-finite μ or σ " +
                $"(μ={rating.Mu}, σ={rating.Sigma}).");
        }

        if (rating.Sigma <= 0.0)
        {
            return new RatingError(
                RatingErrorCode.NonPositiveSigma,
                $"Rating for player {playerIndex} on team {teamIndex} has a non-positive σ of {rating.Sigma}.");
        }

        return null;
    }

    /// <summary>
    /// Validates the injected configuration, returning a <see cref="RatingError"/> describing the first
    /// violation found, or <c>null</c> when the configuration is valid. Validation fails on any
    /// non-finite value, a non-positive initial uncertainty or provisional threshold, a negative decay
    /// parameter, a margin multiplier maximum below 1.0, or tier means that are not strictly ordered
    /// Strong &gt; Average &gt; Beginner (Requirement 11.5).
    /// </summary>
    private static RatingError? ValidateConfig(RatingEngineConfig config)
    {
        // Any non-finite value anywhere in the configuration is invalid.
        if (!IsFinite(config.DefaultMean) ||
            !IsFinite(config.InitialUncertainty) ||
            !IsFinite(config.Beta) ||
            !IsFinite(config.Tau) ||
            !IsFinite(config.ProvisionalThreshold) ||
            !IsFinite(config.DecayRate) ||
            !IsFinite(config.BeginnerMean) ||
            !IsFinite(config.AverageMean) ||
            !IsFinite(config.StrongMean) ||
            !IsFinite(config.MarginMultiplierMax) ||
            !IsFinite(config.NumericTolerance))
        {
            return Invalid("Configuration contains a non-finite value.");
        }

        if (config.InitialUncertainty <= 0.0)
        {
            return Invalid("Configuration InitialUncertainty must be strictly positive.");
        }

        if (config.ProvisionalThreshold <= 0.0)
        {
            return Invalid("Configuration ProvisionalThreshold must be strictly positive.");
        }

        if (config.DecayFreePeriodDays < 0)
        {
            return Invalid("Configuration DecayFreePeriodDays must not be negative.");
        }

        if (config.DecayRate < 0.0)
        {
            return Invalid("Configuration DecayRate must not be negative.");
        }

        if (config.MarginMultiplierMax < 1.0)
        {
            return Invalid("Configuration MarginMultiplierMax must be at least 1.0.");
        }

        if (!(config.StrongMean > config.AverageMean && config.AverageMean > config.BeginnerMean))
        {
            return Invalid("Configuration tier means must be strictly ordered Strong > Average > Beginner.");
        }

        return null;
    }

    private static RatingError Invalid(string message) =>
        new(RatingErrorCode.InvalidConfiguration, message);

    private static bool IsFinite(double value) =>
        !double.IsNaN(value) && !double.IsInfinity(value);

    /// <summary>
    /// Validates the rosters supplied to <see cref="Predict"/> in the design's validation order:
    /// structure first (two or more rosters, each with at least one player — both mapped to
    /// <see cref="RatingErrorCode.InvalidRosterInput"/>, Requirements 10.7, 12.5), then per-rating values
    /// (finite μ/σ via <see cref="RatingErrorCode.NonFiniteValue"/>, σ &gt; 0 via
    /// <see cref="RatingErrorCode.NonPositiveSigma"/>), consistent with the rest of the engine. Returns
    /// the first violation found, or <c>null</c> when every roster is valid. Performs no computation and
    /// never mutates the input.
    /// </summary>
    private static RatingError? ValidateRosters(IReadOnlyList<TeamRoster> rosters)
    {
        // Structure: prediction needs two or more rosters (Requirements 10.7, 12.5).
        if (rosters.Count < 2)
        {
            return new RatingError(
                RatingErrorCode.InvalidRosterInput,
                $"Prediction requires at least two rosters but received {rosters.Count}.");
        }

        // Structure: every roster must contain at least one player (Requirement 10.7).
        for (var rosterIndex = 0; rosterIndex < rosters.Count; rosterIndex++)
        {
            if (rosters[rosterIndex].Players.Count == 0)
            {
                return new RatingError(
                    RatingErrorCode.InvalidRosterInput,
                    $"Roster at index {rosterIndex} contains no players.");
            }
        }

        // Per-rating values: every player's μ/σ must be finite and σ strictly positive, mapped to the
        // same error codes used elsewhere in the engine, checked before any prediction computation.
        for (var rosterIndex = 0; rosterIndex < rosters.Count; rosterIndex++)
        {
            var players = rosters[rosterIndex].Players;
            for (var playerIndex = 0; playerIndex < players.Count; playerIndex++)
            {
                var ratingError = ValidateRatingValues(players[playerIndex], rosterIndex, playerIndex);
                if (ratingError is not null)
                {
                    return ratingError;
                }
            }
        }

        return null;
    }

    /// <summary>
    /// Computes the per-team OpenSkill PlackettLuce <c>predict_win</c> over <paramref name="rosters"/>,
    /// ported from the reference openskill.py implementation. Each team's collective rating is
    /// <c>μᵢ = Σ player μ</c> and <c>σ²ᵢ = Σ player σ²</c>; the pairwise win probability of team <c>i</c>
    /// over team <c>k</c> is <c>Φ((μᵢ − μₖ) / sqrt(2β² + σ²ᵢ + σ²ₖ))</c>. Each team's probability is the
    /// mean of its pairwise probabilities against every other team, then the whole vector is normalised
    /// to sum to 1.0 (Requirements 10.2, 10.3, 10.4). Both μ and σ therefore influence the result
    /// (Requirement 10.2), and rosters with identical rating multisets receive equal probabilities by
    /// construction (Requirement 10.5). The two-team case mirrors the reference's closed form.
    /// </summary>
    private IReadOnlyList<double> ComputePredictWin(IReadOnlyList<TeamRoster> rosters)
    {
        var n = rosters.Count;
        var twoBetaSquared = 2.0 * _config.Beta * _config.Beta;

        var teamMu = new double[n];
        var teamSigmaSquared = new double[n];
        for (var i = 0; i < n; i++)
        {
            AggregateTeam(rosters[i], out teamMu[i], out teamSigmaSquared[i]);
        }

        // Two-team closed form (mirrors openskill.py): a single Φ and its complement.
        if (n == 2)
        {
            var result = PhiMajor(
                (teamMu[0] - teamMu[1]) /
                Math.Sqrt(twoBetaSquared + teamSigmaSquared[0] + teamSigmaSquared[1]));
            return new[] { result, 1.0 - result };
        }

        // N-team case: each team's probability is the mean of its pairwise win probabilities against
        // every other team, accumulated in input order to match the reference's permutation grouping.
        var winProbabilities = new double[n];
        var total = 0.0;
        for (var i = 0; i < n; i++)
        {
            var sum = 0.0;
            for (var k = 0; k < n; k++)
            {
                if (k == i)
                {
                    continue;
                }

                sum += PhiMajor(
                    (teamMu[i] - teamMu[k]) /
                    Math.Sqrt(twoBetaSquared + teamSigmaSquared[i] + teamSigmaSquared[k]));
            }

            var probability = sum / (n - 1);
            winProbabilities[i] = probability;
            total += probability;
        }

        // Normalise so the win probabilities sum to 1.0 within tolerance (Requirement 10.4).
        for (var i = 0; i < n; i++)
        {
            winProbabilities[i] /= total;
        }

        return winProbabilities;
    }

    /// <summary>
    /// Computes the single OpenSkill PlackettLuce <c>predict_draw</c> probability over
    /// <paramref name="rosters"/>, ported from the reference openskill.py implementation and computed
    /// independently of the win probabilities (Requirements 10.2, 10.6). The draw margin is
    /// <c>sqrt(N_players) · β · Φ⁻¹((1 + 1/N_players) / 2)</c>; each unordered pair of teams contributes
    /// <c>Φ((d − μᵢ + μₖ)/s) − Φ((μₖ − μᵢ − d)/s)</c> with <c>s = sqrt(2β² + σ²ᵢ + σ²ₖ)</c>, and the
    /// result is the mean over all pairs. Both μ and σ influence the result, and it lies within
    /// <c>[0, 1]</c> (Requirement 10.6).
    /// </summary>
    private double ComputePredictDraw(IReadOnlyList<TeamRoster> rosters)
    {
        var n = rosters.Count;
        var twoBetaSquared = 2.0 * _config.Beta * _config.Beta;

        var totalPlayerCount = 0;
        var teamMu = new double[n];
        var teamSigmaSquared = new double[n];
        for (var i = 0; i < n; i++)
        {
            totalPlayerCount += rosters[i].Players.Count;
            AggregateTeam(rosters[i], out teamMu[i], out teamSigmaSquared[i]);
        }

        var drawProbability = 1.0 / totalPlayerCount;
        var drawMargin = Math.Sqrt(totalPlayerCount) * _config.Beta *
            PhiMajorInverse((1.0 + drawProbability) / 2.0);

        var sum = 0.0;
        var pairCount = 0;
        for (var i = 0; i < n; i++)
        {
            for (var k = i + 1; k < n; k++)
            {
                var s = Math.Sqrt(twoBetaSquared + teamSigmaSquared[i] + teamSigmaSquared[k]);
                var muA = teamMu[i];
                var muB = teamMu[k];
                sum += PhiMajor((drawMargin - muA + muB) / s)
                     - PhiMajor((muB - muA - drawMargin) / s);
                pairCount++;
            }
        }

        return sum / pairCount;
    }

    /// <summary>
    /// Aggregates a roster into its collective PlackettLuce rating: <c>μ = Σ player μ</c> and
    /// <c>σ² = Σ player σ²</c>. Used by both prediction primitives.
    /// </summary>
    private static void AggregateTeam(TeamRoster roster, out double muSum, out double sigmaSquaredSum)
    {
        muSum = 0.0;
        sigmaSquaredSum = 0.0;
        var players = roster.Players;
        for (var j = 0; j < players.Count; j++)
        {
            muSum += players[j].Mu;
            sigmaSquaredSum += players[j].Sigma * players[j].Sigma;
        }
    }

    /// <summary>
    /// The standard normal cumulative distribution function Φ, used by the prediction primitives
    /// (the openskill.py <c>phi_major</c>). Implemented as <c>0.5 · erfc(−x / √2)</c> via a
    /// dependency-free rational approximation of the complementary error function (fractional error
    /// below ~1.2e-7), keeping the engine self-contained.
    /// </summary>
    private static double PhiMajor(double x) => 0.5 * Erfc(-x / Math.Sqrt(2.0));

    /// <summary>
    /// The inverse standard normal cumulative distribution function Φ⁻¹ (the openskill.py
    /// <c>phi_major_inverse</c>), implemented with Acklam's dependency-free rational approximation
    /// (relative error below ~1.15e-9 across the open interval (0, 1)). Used to derive the draw margin.
    /// </summary>
    private static double PhiMajorInverse(double p)
    {
        // Acklam's algorithm coefficients.
        const double a1 = -3.969683028665376e+01;
        const double a2 = 2.209460984245205e+02;
        const double a3 = -2.759285104469687e+02;
        const double a4 = 1.383577518672690e+02;
        const double a5 = -3.066479806614716e+01;
        const double a6 = 2.506628277459239e+00;

        const double b1 = -5.447609879822406e+01;
        const double b2 = 1.615858368580409e+02;
        const double b3 = -1.556989798598866e+02;
        const double b4 = 6.680131188771972e+01;
        const double b5 = -1.328068155288572e+01;

        const double c1 = -7.784894002430293e-03;
        const double c2 = -3.223964580411365e-01;
        const double c3 = -2.400758277161838e+00;
        const double c4 = -2.549732539343734e+00;
        const double c5 = 4.374664141464968e+00;
        const double c6 = 2.938163982698783e+00;

        const double d1 = 7.784695709041462e-03;
        const double d2 = 3.224671290700398e-01;
        const double d3 = 2.445134137142996e+00;
        const double d4 = 3.754408661907416e+00;

        const double pLow = 0.02425;
        const double pHigh = 1.0 - pLow;

        double q;
        double r;
        if (p < pLow)
        {
            // Lower tail.
            q = Math.Sqrt(-2.0 * Math.Log(p));
            return (((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) /
                   ((((d1 * q + d2) * q + d3) * q + d4) * q + 1.0);
        }

        if (p <= pHigh)
        {
            // Central region.
            q = p - 0.5;
            r = q * q;
            return (((((a1 * r + a2) * r + a3) * r + a4) * r + a5) * r + a6) * q /
                   (((((b1 * r + b2) * r + b3) * r + b4) * r + b5) * r + 1.0);
        }

        // Upper tail.
        q = Math.Sqrt(-2.0 * Math.Log(1.0 - p));
        return -(((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) /
                ((((d1 * q + d2) * q + d3) * q + d4) * q + 1.0);
    }

    /// <summary>
    /// The complementary error function erfc, implemented with a dependency-free rational/exponential
    /// approximation (Numerical Recipes <c>erfcc</c>; fractional error below ~1.2e-7 for all real x).
    /// Backs <see cref="PhiMajor"/> so the engine needs no external numerics package.
    /// </summary>
    private static double Erfc(double x)
    {
        var z = Math.Abs(x);
        var t = 1.0 / (1.0 + 0.5 * z);
        var ans = t * Math.Exp(-z * z - 1.26551223 +
            t * (1.00002368 +
            t * (0.37409196 +
            t * (0.09678418 +
            t * (-0.18628806 +
            t * (0.27886807 +
            t * (-1.13520398 +
            t * (1.48851587 +
            t * (-0.82215223 +
            t * 0.17087277)))))))));

        return x >= 0.0 ? ans : 2.0 - ans;
    }
}
