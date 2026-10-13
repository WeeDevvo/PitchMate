using PitchMate.Domain.Matches;

namespace PitchMate.Infrastructure.Tests.Matches;

/// <summary>
/// The abstract description of a match-list dataset that
/// <see cref="MatchListDatasetSeeder"/> materialises into real PostgreSQL for the
/// <see cref="PitchMate.Infrastructure.Matches.Queries.EfMatchListSource"/> integration tests
/// (match-read-models task 5.3).
/// <para>
/// It is deliberately leaner than <c>StatsDatasetSpec</c>: the list read never looks at rosters,
/// ratings, snapshots or display names, so the only things worth varying are the dimensions the
/// read's own contract depends on — a match's lifecycle state, its candidate days (including days
/// supplied out of chronological order), which candidate day is confirmed, how many participants it
/// carries, and whether it is soft-deleted.
/// </para>
/// </summary>
/// <param name="Squads">The squads to seed, in order; a test reads them back by index.</param>
internal sealed record MatchListDatasetSpec(IReadOnlyList<MatchListDatasetSpec.SquadSpec> Squads)
{
    /// <summary>One squad: a pool of registered memberships plus the matches to build in it.</summary>
    /// <param name="MemberCount">
    /// The number of active registered memberships to create. Must be at least the largest
    /// <see cref="MatchSpec.ParticipantCount"/> of any of the squad's matches, because a participant
    /// is drawn from this pool.
    /// </param>
    /// <param name="Matches">The matches to build in this squad, in creation order.</param>
    /// <param name="SoftDeleteSquad">
    /// Whether the squad itself is soft-deleted after seeding, putting it inside its deletion grace
    /// period — the case the source must report as "not visible" rather than as an empty page.
    /// </param>
    internal sealed record SquadSpec(
        int MemberCount,
        IReadOnlyList<MatchSpec> Matches,
        bool SoftDeleteSquad = false);

    /// <summary>One match, built through the real aggregate lifecycle to <paramref name="State"/>.</summary>
    /// <param name="State">The lifecycle state to drive the match to.</param>
    /// <param name="CandidateDayOffsetDays">
    /// The candidate days as whole-day offsets from the dataset's anchor instant, <b>in the order the
    /// draft supplies them</b> — which need not be chronological, so that the ordering key's
    /// "earliest of the candidate days" clause is exercised rather than accidentally satisfied by
    /// taking the first element. Must be 1 to 14 distinct strictly-positive offsets.
    /// </param>
    /// <param name="ConfirmedDayIndex">
    /// The index into <see cref="CandidateDayOffsetDays"/> of the day the match is confirmed on.
    /// Ignored while the match stops at <see cref="MatchState.GatheringAvailability"/>.
    /// </param>
    /// <param name="ParticipantCount">
    /// The number of participants to add from the squad's pool. Must be 0 for a match that stops at
    /// <see cref="MatchState.GatheringAvailability"/> (the aggregate admits participants only once
    /// confirmed), and 10 to 16 for a match that is rolled, because a lock requires two teams of 5 to
    /// 8 players.
    /// </param>
    /// <param name="SoftDeleted">Whether the match is soft-deleted after seeding, so the read must exclude it.</param>
    /// <param name="CompletedOffsetSeconds">A per-match offset that makes completion instants distinct.</param>
    internal sealed record MatchSpec(
        MatchState State,
        IReadOnlyList<int> CandidateDayOffsetDays,
        int ConfirmedDayIndex = 0,
        int ParticipantCount = 0,
        bool SoftDeleted = false,
        int CompletedOffsetSeconds = 0);
}
