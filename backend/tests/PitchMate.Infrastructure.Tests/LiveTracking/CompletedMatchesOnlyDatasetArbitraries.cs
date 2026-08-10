using FsCheck;
using PitchMate.Infrastructure.Tests.Stats;

namespace PitchMate.Infrastructure.Tests.LiveTracking;

/// <summary>
/// FsCheck <see cref="Arbitrary{T}"/> registration for the completed-matches-only rich-statistics
/// model-based test (task 13.4, design <c>Property 17</c>). It reuses the stats dataset generator's
/// single-<see cref="StatsDatasetSpec.SquadSpec"/> factory — which already produces a shared
/// membership pool and matches spanning <em>every</em> <c>MatchState</c> (including non-completed
/// states that carry locked kickoff lineups) — and forces <c>LiveMatchTracking</c> on, since the
/// <c>EventLogRichStatsSource</c> only surfaces rich statistics for a tracking-enabled squad
/// (Requirement 9.2). The generated matches drawn from that spec become the substrate onto which the
/// test attaches an append-only <c>MatchEvent</c> log, so events land on completed <em>and</em>
/// non-completed (including <c>Cancelled</c>) matches and the test can prove only the completed ones
/// contribute (Requirement 10.7, 12.4).
/// </summary>
public static class CompletedMatchesOnlyDatasetArbitraries
{
    /// <summary>A single tracking-enabled squad with a membership pool and matches across all states.</summary>
    public static Arbitrary<StatsDatasetSpec> Dataset() =>
        Arb.From(
            from squad in StatsDatasetGenerators.Squad()
            select new StatsDatasetSpec([squad with { LiveMatchTracking = true }]));
}
