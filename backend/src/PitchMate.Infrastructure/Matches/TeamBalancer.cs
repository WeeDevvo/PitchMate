using PitchMate.Application.Matches.Abstractions;
// PitchMate.Domain.Matches and PitchMate.Domain.Rating each define a Result<T>; import the Matches
// namespace so the unqualified Result/Result<T>/MatchError/MatchErrorCode bind to the match-lifecycle
// triad this balancer returns, and alias the specific rating types it consumes so their names stay
// explicit and never collide.
using PitchMate.Domain.Matches;
using IRatingEngine = PitchMate.Domain.Rating.IRatingEngine;
using MatchPrediction = PitchMate.Domain.Rating.MatchPrediction;
using PlayerRating = PitchMate.Domain.Rating.Rating;
using TeamRoster = PitchMate.Domain.Rating.TeamRoster;
using PredictionResult = PitchMate.Domain.Rating.Result<PitchMate.Domain.Rating.MatchPrediction>;

namespace PitchMate.Infrastructure.Matches;

/// <summary>
/// The MVP implementation of <see cref="ITeamBalancer"/>. For a small squad (participant count ≤ 16)
/// it brute-forces every balanced two-team split, scores each with
/// <see cref="IRatingEngine.Predict"/>, and returns the split whose predicted result is closest to
/// 50/50 — tie-broken toward the less skill-concentrated arrangement (Requirement 8.1).
/// <para>
/// The balancer performs <b>no rating arithmetic itself</b>: it never reads μ/σ to derive a strength,
/// never sums or averages ratings, and never reimplements the win/draw prediction. The rating
/// engine's <see cref="MatchPrediction"/> primitives are the sole source of every fairness judgement
/// it makes (Requirement 8.8). Fairness is measured from the per-team win probabilities (a split is
/// fairer the smaller the gap between the two teams' win probabilities), and skill concentration is
/// read from the same prediction's draw probability — among arrangements equally close to 50/50 the
/// one the engine judges more likely to end level is the less concentrated, more evenly matched split,
/// so it is preferred.
/// </para>
/// <para>
/// Producing a proposal changes no match state and alters no rating. An invalid request — fewer than
/// two teams, a team count this MVP balancer does not form, too few participants to fill the teams, or
/// more participants than the brute-force bound admits — yields a
/// <see cref="MatchErrorCode.ValidationFailed"/> failure and no proposal.
/// </para>
/// </summary>
public sealed class TeamBalancer : ITeamBalancer
{
    /// <summary>The number of teams this MVP balancer forms; the abstraction is N-team capable, the implementation is not yet.</summary>
    private const int SupportedTeamCount = 2;

    /// <summary>The largest participant count for which exhaustive brute-force search is used (Requirement 8.1).</summary>
    private const int MaxParticipants = 16;

    /// <summary>Absolute tolerance within which two fairness gaps (and two draw probabilities) are treated as equal.</summary>
    private const double Tolerance = 1e-9;

    private readonly IRatingEngine _ratingEngine;

    /// <summary>
    /// Creates the balancer over the rating engine whose <see cref="IRatingEngine.Predict"/> primitive
    /// is the only source of every fairness judgement it makes (Requirement 8.8).
    /// </summary>
    /// <param name="ratingEngine">The pure rating engine used to score candidate splits.</param>
    public TeamBalancer(IRatingEngine ratingEngine)
    {
        ArgumentNullException.ThrowIfNull(ratingEngine);
        _ratingEngine = ratingEngine;
    }

    /// <inheritdoc />
    public Task<Result<TeamProposal>> ProposeAsync(TeamBalanceRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        // The search is pure and CPU-bound: IRatingEngine.Predict has no I/O to await. The work is
        // performed synchronously (honouring cancellation between candidate splits) and returned as a
        // completed task.
        return Task.FromResult(Propose(request, cancellationToken));
    }

    private Result<TeamProposal> Propose(TeamBalanceRequest request, CancellationToken cancellationToken)
    {
        if (request.TeamCount < SupportedTeamCount)
        {
            return Fail($"A team proposal requires at least {SupportedTeamCount} teams; {request.TeamCount} were requested.");
        }

        if (request.TeamCount != SupportedTeamCount)
        {
            return Fail($"This balancer forms exactly {SupportedTeamCount} teams; {request.TeamCount} were requested.");
        }

        IReadOnlyList<BalancerParticipant> participants = request.Participants;
        int count = participants.Count;

        if (count < SupportedTeamCount)
        {
            return Fail($"At least {SupportedTeamCount} participants are required to fill {SupportedTeamCount} teams; {count} were offered.");
        }

        if (count > MaxParticipants)
        {
            return Fail($"Brute-force balancing supports up to {MaxParticipants} participants; {count} were offered.");
        }

        // Balanced sizes: the larger team takes the ceiling, the smaller the floor, so an odd count
        // yields an even split off by one (e.g. 7 vs 6) — the uneven arrangement product.md allows.
        int sizeA = (count + 1) / 2;
        bool evenSplit = count % 2 == 0;

        // Track the best split found so far. Fairness (smaller win-probability gap) dominates; a higher
        // draw probability breaks ties toward the less skill-concentrated arrangement.
        bool hasBest = false;
        double bestGap = 0;
        double bestDraw = 0;
        double bestWinA = 0;
        double bestWinB = 0;
        int[]? bestTeamA = null;
        int[]? bestTeamB = null;

        // Enumerate every candidate split exactly once. For an even count both teams are the same size,
        // so pinning participant 0 to team A avoids evaluating each split and its mirror image. For an
        // odd count the teams differ in size, so choosing the larger team already lists each split once.
        int[] candidateIndices = evenSplit
            ? BuildRange(1, count - 1)
            : BuildRange(0, count);
        int chooseCount = evenSplit ? sizeA - 1 : sizeA;

        foreach (int[] combination in Combinations(candidateIndices, chooseCount))
        {
            cancellationToken.ThrowIfCancellationRequested();

            bool[] inTeamA = new bool[count];
            if (evenSplit)
            {
                inTeamA[0] = true;
            }

            foreach (int index in combination)
            {
                inTeamA[index] = true;
            }

            int[] teamA = new int[sizeA];
            int[] teamB = new int[count - sizeA];
            int a = 0;
            int b = 0;
            for (int i = 0; i < count; i++)
            {
                if (inTeamA[i])
                {
                    teamA[a++] = i;
                }
                else
                {
                    teamB[b++] = i;
                }
            }

            PredictionResult prediction = _ratingEngine.Predict(
                new[]
                {
                    new TeamRoster(ToRatings(participants, teamA)),
                    new TeamRoster(ToRatings(participants, teamB)),
                });

            if (!prediction.IsSuccess)
            {
                // Predict only fails for fewer than two rosters or an empty roster, neither of which this
                // search produces; surface any failure faithfully rather than silently skipping a split.
                return Fail($"The rating engine could not score a candidate split: {prediction.Error?.Message}");
            }

            MatchPrediction outcome = prediction.Value!;
            double winA = outcome.WinProbabilities[0];
            double winB = outcome.WinProbabilities[1];
            double gap = Math.Abs(winA - winB);
            double draw = outcome.DrawProbability;

            if (IsBetter(hasBest, gap, draw, bestGap, bestDraw))
            {
                hasBest = true;
                bestGap = gap;
                bestDraw = draw;
                bestWinA = winA;
                bestWinB = winB;
                bestTeamA = teamA;
                bestTeamB = teamB;
            }
        }

        // count >= 2 always yields at least one split, so a best is guaranteed here.
        var teams = new[]
        {
            new ProposedTeamAssignment(ToMembershipIds(participants, bestTeamA!), bestWinA),
            new ProposedTeamAssignment(ToMembershipIds(participants, bestTeamB!), bestWinB),
        };

        return Result<TeamProposal>.Ok(new TeamProposal(teams, bestDraw));
    }

    /// <summary>
    /// Decides whether a candidate split beats the incumbent: a strictly smaller win-probability gap
    /// wins outright; an equal gap (within tolerance) is broken toward the higher draw probability, the
    /// less skill-concentrated arrangement (Requirement 8.1).
    /// </summary>
    private static bool IsBetter(bool hasBest, double gap, double draw, double bestGap, double bestDraw)
    {
        if (!hasBest)
        {
            return true;
        }

        double gapDelta = gap - bestGap;
        if (gapDelta < -Tolerance)
        {
            return true;
        }

        return Math.Abs(gapDelta) <= Tolerance && draw > bestDraw + Tolerance;
    }

    private static IReadOnlyList<PlayerRating> ToRatings(IReadOnlyList<BalancerParticipant> participants, int[] indices)
    {
        var ratings = new PlayerRating[indices.Length];
        for (int i = 0; i < indices.Length; i++)
        {
            ratings[i] = participants[indices[i]].Rating;
        }

        return ratings;
    }

    private static IReadOnlyList<Guid> ToMembershipIds(IReadOnlyList<BalancerParticipant> participants, int[] indices)
    {
        var ids = new Guid[indices.Length];
        for (int i = 0; i < indices.Length; i++)
        {
            ids[i] = participants[indices[i]].SquadMembershipId;
        }

        return ids;
    }

    private static int[] BuildRange(int start, int endExclusive)
    {
        var range = new int[endExclusive - start];
        for (int i = 0; i < range.Length; i++)
        {
            range[i] = start + i;
        }

        return range;
    }

    /// <summary>
    /// Lazily yields every <paramref name="k"/>-sized combination of <paramref name="items"/> in
    /// ascending index order, each combination allocated fresh so the caller may retain it.
    /// </summary>
    private static IEnumerable<int[]> Combinations(int[] items, int k)
    {
        int n = items.Length;
        if (k < 0 || k > n)
        {
            yield break;
        }

        if (k == 0)
        {
            yield return Array.Empty<int>();
            yield break;
        }

        int[] cursor = new int[k];
        for (int i = 0; i < k; i++)
        {
            cursor[i] = i;
        }

        while (true)
        {
            int[] combination = new int[k];
            for (int i = 0; i < k; i++)
            {
                combination[i] = items[cursor[i]];
            }

            yield return combination;

            int position = k - 1;
            while (position >= 0 && cursor[position] == n - k + position)
            {
                position--;
            }

            if (position < 0)
            {
                yield break;
            }

            cursor[position]++;
            for (int i = position + 1; i < k; i++)
            {
                cursor[i] = cursor[i - 1] + 1;
            }
        }
    }

    private static Result<TeamProposal> Fail(string message) =>
        Result<TeamProposal>.Fail(new MatchError(MatchErrorCode.ValidationFailed, message));
}
