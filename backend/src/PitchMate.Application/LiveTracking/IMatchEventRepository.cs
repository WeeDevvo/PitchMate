using PitchMate.Domain.LiveTracking;

namespace PitchMate.Application.LiveTracking;

/// <summary>
/// Append-only persistence access to a match's event log, keyed on the client-generated GUID v7
/// <c>Event_Id</c>. Declared in Application so the recording, finalising, and query use cases stay
/// free of EF Core / Npgsql types; implemented in Infrastructure over the <c>PitchMateDbContext</c>
/// (Requirement 14.2). The log is strictly append-only: this interface exposes no update or delete
/// path, upholding the immutability of an accepted <see cref="MatchEvent"/> (Requirement 1.3).
/// </summary>
public interface IMatchEventRepository
{
    /// <summary>
    /// Retrieves the set of <c>Event_Id</c>s already present for <paramref name="matchId"/>, so the
    /// recording path can classify each submitted event as new or a duplicate in O(1) without loading
    /// the full events (Requirement 1.2, 2.2). Returns an empty set when the match has no events.
    /// </summary>
    /// <param name="matchId">The match whose existing event identities are read.</param>
    /// <param name="ct">A token that surfaces cancellation to the caller.</param>
    /// <returns>The <c>Event_Id</c>s already stored for the match, or an empty set.</returns>
    Task<IReadOnlySet<Guid>> GetExistingEventIdsAsync(Guid matchId, CancellationToken ct);

    /// <summary>
    /// Stages the newly-accepted <paramref name="events"/> for insert on the atomic unit-of-work
    /// commit. This never updates or deletes a stored event — an accepted <see cref="MatchEvent"/> is
    /// immutable and corrections are recorded as compensating retraction events (Requirement 1.3).
    /// </summary>
    /// <param name="events">The accepted events to append; the rows are written on the unit-of-work commit.</param>
    /// <param name="ct">A token that surfaces cancellation to the caller.</param>
    Task AppendAsync(IReadOnlyList<MatchEvent> events, CancellationToken ct);

    /// <summary>
    /// Retrieves every accepted <see cref="MatchEvent"/> for <paramref name="matchId"/>, the input to
    /// the pure derivation projection that computes the running score, keeper stints, and per-match
    /// rich statistics. Returns an empty list when the match has no events.
    /// </summary>
    /// <param name="matchId">The match whose full event log is read for derivation.</param>
    /// <param name="ct">A token that surfaces cancellation to the caller.</param>
    /// <returns>The match's accepted events, or an empty list.</returns>
    Task<IReadOnlyList<MatchEvent>> GetForMatchAsync(Guid matchId, CancellationToken ct);

    /// <summary>
    /// Retrieves every accepted <see cref="MatchEvent"/> across the <c>Completed</c> matches of
    /// <paramref name="squadId"/>, the input to the <c>IRichStatsSource</c> seam so rich statistics are
    /// computed from completed matches only — non-completed and cancelled matches contribute nothing
    /// (Requirement 10.7). Returns an empty list when the squad has no such events.
    /// </summary>
    /// <param name="squadId">The squad whose completed matches' events are read for the stats seam.</param>
    /// <param name="ct">A token that surfaces cancellation to the caller.</param>
    /// <returns>The accepted events across the squad's completed matches, or an empty list.</returns>
    Task<IReadOnlyList<MatchEvent>> GetForSquadCompletedMatchesAsync(Guid squadId, CancellationToken ct);
}
