using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Common;
using PitchMate.Domain.Rating;
using PitchMate.Domain.Squads;
using PitchMate.Domain.Stats;

// Alias the rating value type: within this file the unqualified name `Rating` otherwise binds to the
// sibling namespace PitchMate.Domain.Rating rather than the Rating record used to classify state.
using PlayerRating = PitchMate.Domain.Rating.Rating;

namespace PitchMate.Application.Stats;

/// <summary>
/// Returns a squad-scoped <see cref="PlayerProfile"/> for a subject membership to an active member of
/// the same squad (Requirement 3.1). The handler resolves the requester's membership from the
/// authenticated token subject and gates the read through
/// <see cref="StatsAuthorization.RequireActiveMember"/>; a non-member, an inactive member, or a
/// requester whose only membership is in another squad receives the single uniform authorisation
/// failure that discloses nothing (Requirement 1.1, 1.2, 1.4, 1.6). It then resolves the subject
/// membership within the target squad — a subject that does not belong to the squad yields a uniform
/// <see cref="StatsErrorCode.NotFound"/> answered identically to a genuinely non-existent membership
/// (Requirement 3.6) — and shapes the always-available statistics from the squad-scoped aggregates
/// using the pure Domain calculators. It returns the profile regardless of the subject's
/// <see cref="MembershipState"/> (Requirement 3.1) and uses the "Former player" placeholder display
/// name already carried by an anonymised membership (Requirement 3.5, 14.4).
/// <para>
/// Rich statistics are gated on the squad's <see cref="SquadFeature.LiveMatchTracking"/> flag: when
/// the feature is disabled they are omitted entirely (<see cref="PlayerProfile.Rich"/> is
/// <see langword="null"/>, no placeholder), and when it is enabled they are surfaced from
/// <see cref="IRichStatsSource"/> — reported as "no data" (a <see cref="RichStats"/> whose every field
/// is <see langword="null"/>) when the source has none (Requirement 3.2, 13.1, 13.2, 13.6, 13.7,
/// 13.8). An aggregation failure aborts the request and returns
/// <see cref="StatsErrorCode.ComputationFailed"/> with no partial payload (Requirement 2.6). A subject
/// with no appearance yields zero/empty values and a not-yet-established rating (Requirement 3.4).
/// </para>
/// </summary>
public sealed class GetPlayerProfileHandler
{
    private readonly ISquadMembershipRepository _memberships;
    private readonly ISquadRepository _squads;
    private readonly IStatsRepository _stats;
    private readonly IDisplayRatingParametersSource _parameters;
    private readonly IRichStatsSource _richStats;
    private readonly IRatingEngine _ratingEngine;

    /// <summary>Creates the handler with the repositories, sources, and rating engine it reads through.</summary>
    /// <param name="memberships">Resolves the requester's membership for authorisation.</param>
    /// <param name="squads">Loads the squad to read its <see cref="SquadFeature.LiveMatchTracking"/> flag.</param>
    /// <param name="stats">Provides the squad-scoped, completed-only aggregates the profile is shaped from.</param>
    /// <param name="parameters">Provides the squad's display-rating parameters.</param>
    /// <param name="richStats">Provides the rich-tracking statistics when the feature is enabled.</param>
    /// <param name="ratingEngine">Classifies rating state via <see cref="IRatingEngine.GetState"/>.</param>
    public GetPlayerProfileHandler(
        ISquadMembershipRepository memberships,
        ISquadRepository squads,
        IStatsRepository stats,
        IDisplayRatingParametersSource parameters,
        IRichStatsSource richStats,
        IRatingEngine ratingEngine)
    {
        ArgumentNullException.ThrowIfNull(memberships);
        ArgumentNullException.ThrowIfNull(squads);
        ArgumentNullException.ThrowIfNull(stats);
        ArgumentNullException.ThrowIfNull(parameters);
        ArgumentNullException.ThrowIfNull(richStats);
        ArgumentNullException.ThrowIfNull(ratingEngine);

        _memberships = memberships;
        _squads = squads;
        _stats = stats;
        _parameters = parameters;
        _richStats = richStats;
        _ratingEngine = ratingEngine;
    }

    /// <summary>
    /// Handles a <see cref="GetPlayerProfileCommand"/>, returning the subject's profile on success or a
    /// typed failure: the uniform <see cref="StatsErrorCode.Unauthorized"/> when the requester is not an
    /// active member, <see cref="StatsErrorCode.NotFound"/> when the subject does not belong to the
    /// squad, or <see cref="StatsErrorCode.ComputationFailed"/> when aggregation fails.
    /// </summary>
    /// <param name="command">The profile-read request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result<PlayerProfile>> HandleAsync(GetPlayerProfileCommand command, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        // Resolve the requester from the token subject and gate to an active member. A non-member,
        // inactive member, or member of a different squad is rejected uniformly (Requirement 1.1, 1.5).
        SquadMembership? requester =
            await _memberships.GetByUserAndSquadAsync(command.RequestingUserId, command.SquadId, cancellationToken);

        Result gate = StatsAuthorization.RequireActiveMember(requester);
        if (!gate.IsSuccess)
        {
            return Result<PlayerProfile>.Fail(gate.Error!);
        }

        try
        {
            // Resolve the subject within the target squad; a subject in another squad or none at all is
            // a uniform NotFound answered identically to a non-existent membership (Requirement 3.6).
            MembershipRef? subject = await _stats.FindMembershipAsync(command.SquadId, command.MembershipId, cancellationToken);
            if (subject is null)
            {
                return NotFound();
            }

            MembershipStatsData? data =
                await _stats.GetMembershipStatsAsync(command.SquadId, command.MembershipId, cancellationToken);
            if (data is null)
            {
                return NotFound();
            }

            DisplayRatingParameters parameters = await _parameters.GetAsync(command.SquadId, cancellationToken);

            PlayerProfile profile = await ShapeAsync(command, subject, data, parameters, cancellationToken);
            return Result<PlayerProfile>.Ok(profile);
        }
        catch (OperationCanceledException)
        {
            // A cancelled request surfaces as cancellation, not a computed result.
            throw;
        }
        catch (Exception ex)
        {
            // An aggregation query failed or a source was unavailable: abort with no partial payload
            // (Requirement 2.6).
            return Result<PlayerProfile>.Fail(new StatsError(
                StatsErrorCode.ComputationFailed,
                $"The statistics could not be computed: {ex.Message}"));
        }
    }

    /// <summary>Shapes the aggregates into the final <see cref="PlayerProfile"/> using the Domain calculators.</summary>
    private async Task<PlayerProfile> ShapeAsync(
        GetPlayerProfileCommand command,
        MembershipRef subject,
        MembershipStatsData data,
        DisplayRatingParameters parameters,
        CancellationToken cancellationToken)
    {
        var record = new PlayerRecord(data.Appearances, data.Wins, data.Draws, data.Losses);
        double? winPercentage = WinPercentage.Compute(data.Wins, data.Appearances);

        // Not-yet-established when there is no rating; otherwise classified/computed by the Domain
        // summary (Requirement 7.1, 7.7).
        RatingSummary rating = data.Mu.HasValue && data.Sigma.HasValue
            ? RatingSummary.FromRating(_ratingEngine, data.Mu.Value, data.Sigma.Value, parameters)
            : RatingSummary.NotYetEstablished;

        int winStreak = StreakCalculator.LongestWinStreak(data.Results);
        int unbeatenStreak = StreakCalculator.LongestUnbeatenStreak(data.Results);

        IReadOnlyList<RatingProgressionPoint> progression = BuildProgression(data.Snapshots, parameters);
        IReadOnlyList<CoAppearance> mostPlayedWith = BuildCoAppearances(data.CoAppearances, teammates: true);
        IReadOnlyList<CoAppearance> mostPlayedAgainst = BuildCoAppearances(data.CoAppearances, teammates: false);
        IReadOnlyList<PairedStat> bestPartnerships = BuildPairedStats(data.Partnerships, bestFirst: true);
        IReadOnlyList<PairedStat> bogeyOpponents = BuildPairedStats(data.BogeyOpponents, bestFirst: false);

        RichStats? rich = await ResolveRichAsync(command, cancellationToken);

        return new PlayerProfile(
            subject.MembershipId,
            subject.DisplayName,
            subject.State,
            subject.IsGuest,
            record,
            winPercentage,
            rating,
            progression,
            winStreak,
            unbeatenStreak,
            mostPlayedWith,
            mostPlayedAgainst,
            bestPartnerships,
            bogeyOpponents,
            data.BibAppearances,
            rich);
    }

    /// <summary>
    /// Builds the rating progression: one point per snapshot ordered by completion instant then match
    /// identity, each carrying the snapshot's μ/σ, its state from <see cref="IRatingEngine.GetState"/>,
    /// and a display rating iff established (Requirement 8.1, 8.2, 8.3, 8.6). Empty when no snapshot
    /// exists (Requirement 8.4).
    /// </summary>
    private IReadOnlyList<RatingProgressionPoint> BuildProgression(
        IReadOnlyList<MembershipStatsData.RatingSnapshotRow> snapshots,
        DisplayRatingParameters parameters)
    {
        var points = new List<RatingProgressionPoint>(snapshots.Count);

        IEnumerable<MembershipStatsData.RatingSnapshotRow> ordered = snapshots
            .OrderBy(s => s.CompletedAt)
            .ThenBy(s => s.MatchId, UuidV7Comparer.Instance);

        foreach (MembershipStatsData.RatingSnapshotRow snapshot in ordered)
        {
            var stateResult = _ratingEngine.GetState(new PlayerRating(snapshot.Mu, snapshot.Sigma));
            if (!stateResult.IsSuccess)
            {
                throw new InvalidOperationException(
                    $"Unable to classify rating state for a progression point: {stateResult.Error?.Message}");
            }

            RatingState state = stateResult.Value;
            int? displayRating = DisplayRatingCalculator.Compute(state, snapshot.Mu, snapshot.Sigma, parameters);
            points.Add(new RatingProgressionPoint(snapshot.CompletedAt, snapshot.Mu, snapshot.Sigma, state, displayRating));
        }

        return points;
    }

    /// <summary>
    /// Builds a "most played with" (teammate) or "most played against" (opponent) list: the other
    /// memberships with a positive co-appearance count, ranked by descending count then ascending
    /// membership identity (Requirement 10.3, 10.7). Empty when there is no positive co-appearance
    /// (Requirement 10.6).
    /// </summary>
    private static IReadOnlyList<CoAppearance> BuildCoAppearances(
        IReadOnlyList<MembershipStatsData.CoAppearanceRow> rows,
        bool teammates)
    {
        return rows
            .Select(r => new CoAppearance(r.MembershipId, r.DisplayName, teammates ? r.TeammateCount : r.OpponentCount))
            .Where(c => c.Count > 0)
            .OrderByDescending(c => c.Count)
            .ThenBy(c => c.MembershipId, UuidV7Comparer.Instance)
            .ToList();
    }

    /// <summary>
    /// Builds the "best partnerships" or "bogey opponents" list from the already-qualifying rows: the
    /// subject's win percentage over each shared subset, ranked by descending value for partnerships or
    /// ascending value for bogey opponents, tie-broken first by descending qualifying-match count then
    /// by ascending membership identity (Requirement 11.1, 11.2, 11.4). Empty when there is no
    /// qualifying row (Requirement 11.6).
    /// </summary>
    private static IReadOnlyList<PairedStat> BuildPairedStats(
        IReadOnlyList<MembershipStatsData.PairedStatRow> rows,
        bool bestFirst)
    {
        IEnumerable<PairedStat> stats = rows.Select(r => new PairedStat(
            r.MembershipId,
            r.DisplayName,
            WinPercentage.Compute(r.Wins, r.QualifyingMatches) ?? 0.0,
            r.QualifyingMatches));

        IOrderedEnumerable<PairedStat> ordered = bestFirst
            ? stats.OrderByDescending(s => s.Value)
            : stats.OrderBy(s => s.Value);

        return ordered
            .ThenByDescending(s => s.QualifyingMatches)
            .ThenBy(s => s.MembershipId, UuidV7Comparer.Instance)
            .ToList();
    }

    /// <summary>
    /// Resolves the rich statistics under the feature gate: omitted (<see langword="null"/>) when
    /// <see cref="SquadFeature.LiveMatchTracking"/> is disabled; the source's data when enabled and
    /// present; or a "no data" <see cref="RichStats"/> (all fields <see langword="null"/>) when enabled
    /// but the source has none (Requirement 3.2, 13.1, 13.2, 13.6, 13.7, 13.8).
    /// </summary>
    private async Task<RichStats?> ResolveRichAsync(GetPlayerProfileCommand command, CancellationToken cancellationToken)
    {
        Squad? squad = await _squads.GetByIdAsync(command.SquadId, cancellationToken);
        bool trackingEnabled = squad is not null && squad.IsFeatureEnabled(SquadFeature.LiveMatchTracking);
        if (!trackingEnabled)
        {
            // Disabled: omit the rich stats entirely with no placeholder (Requirement 3.2, 13.1).
            return null;
        }

        RichStats? rich = await _richStats.GetForMembershipAsync(command.SquadId, command.MembershipId, cancellationToken);

        // Enabled but no data: report each field as "no data" rather than zero (Requirement 13.2, 13.7).
        return rich ?? new RichStats(null, null, null, null);
    }

    private static Result<PlayerProfile> NotFound() =>
        Result<PlayerProfile>.Fail(new StatsError(
            StatsErrorCode.NotFound,
            "The requested profile could not be found."));
}
