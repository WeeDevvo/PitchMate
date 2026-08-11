using Microsoft.EntityFrameworkCore;
using PitchMate.Application.LiveTracking;
using PitchMate.Domain.LiveTracking;
using PitchMate.Domain.Matches;
using PitchMate.Infrastructure.Persistence;

namespace PitchMate.Infrastructure.LiveTracking;

/// <summary>
/// EF Core implementation of <see cref="IMatchEventRepository"/> over the shared
/// <see cref="PitchMateDbContext"/>. Registered scoped so it shares the request's unit-of-work
/// transaction: appended events are staged on the change tracker and committed by the surrounding
/// <c>IUnitOfWork.SaveChangesAsync</c> — this repository never calls <c>SaveChanges</c> itself. Default
/// reads honour the global soft-delete query filter.
/// <para>
/// The log is strictly append-only: this type exposes no update or delete path, upholding the
/// immutability of an accepted <see cref="MatchEvent"/> (Requirement 1.3). In-match corrections are
/// recorded as compensating retraction events, never as in-place edits.
/// </para>
/// <para>
/// Reads used only to feed the pure derivation projection (<see cref="GetForMatchAsync"/>,
/// <see cref="GetForSquadCompletedMatchesAsync"/>) and the O(1) duplicate-classification set
/// (<see cref="GetExistingEventIdsAsync"/>) run untracked, since none of them mutate the loaded events.
/// The table-per-hierarchy mapping materialises each row as its concrete <see cref="EventKind"/>
/// subclass. <see cref="GetForSquadCompletedMatchesAsync"/> joins each event to its squad's
/// <see cref="MatchState.Completed"/> matches inside the database so non-completed and <c>Cancelled</c>
/// matches contribute nothing to the rich-statistics seam (Requirement 10.7, 12.4).
/// </para>
/// </summary>
internal sealed class EfMatchEventRepository(PitchMateDbContext db) : IMatchEventRepository
{
    /// <inheritdoc />
    public async Task<IReadOnlySet<Guid>> GetExistingEventIdsAsync(Guid matchId, CancellationToken ct)
    {
        // Project only the Event_Id column so classification never loads the full event rows
        // (Requirement 1.2, 2.2). The materialised set gives O(1) duplicate lookups.
        var ids = await db.Set<MatchEvent>()
            .AsNoTracking()
            .Where(matchEvent => matchEvent.MatchId == matchId)
            .Select(matchEvent => matchEvent.Id)
            .ToListAsync(ct);

        return ids.ToHashSet();
    }

    /// <inheritdoc />
    public async Task AppendAsync(IReadOnlyList<MatchEvent> events, CancellationToken ct)
        // Stage the newly-accepted events for insert on the atomic unit-of-work commit. This is the
        // only write path — there is no update or delete, so an accepted event stays immutable
        // (Requirement 1.3). The rows are written when IUnitOfWork.SaveChangesAsync runs.
        => await db.Set<MatchEvent>().AddRangeAsync(events, ct);

    /// <inheritdoc />
    public async Task<IReadOnlyList<MatchEvent>> GetForMatchAsync(Guid matchId, CancellationToken ct)
        // Every accepted event for the match, the input to the pure derivation projection. Read
        // untracked since the projection never mutates the events.
        => await db.Set<MatchEvent>()
            .AsNoTracking()
            .Where(matchEvent => matchEvent.MatchId == matchId)
            .ToListAsync(ct);

    /// <inheritdoc />
    public async Task<IReadOnlyList<MatchEvent>> GetForSquadCompletedMatchesAsync(
        Guid squadId, CancellationToken ct)
        // Every accepted event across the squad's Completed matches, the input to the IRichStatsSource
        // seam. Joining to the Completed matches in the database means non-completed and Cancelled
        // matches contribute nothing; the global soft-delete filter on Match also excludes purged
        // matches (Requirement 10.7, 12.4).
        => await db.Set<MatchEvent>()
            .AsNoTracking()
            .Where(matchEvent => matchEvent.SquadId == squadId)
            .Join(
                db.Set<Match>().Where(match => match.State == MatchState.Completed),
                matchEvent => matchEvent.MatchId,
                match => match.Id,
                (matchEvent, _) => matchEvent)
            .ToListAsync(ct);
}
