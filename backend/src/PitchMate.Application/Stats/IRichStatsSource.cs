namespace PitchMate.Application.Stats;

/// <summary>
/// Source of the rich-tracking-only statistics (goals, clean sheets, goals conceded as keeper, keeper
/// time, and the squad top scorer) surfaced only when a squad has <c>LiveMatchTracking</c> enabled.
/// This spec depends only on the abstraction and does <b>not</b> define or capture goal-event or
/// goalkeeper-stint data (Requirement 13.5); the MVP implementation reports no data for every
/// membership and squad, and the live-tracking spec replaces it (Requirement 13.3, 13.4). A
/// <see langword="null"/> result means "no data" — distinct from a zero value.
/// </summary>
public interface IRichStatsSource
{
    /// <summary>
    /// Retrieves the rich statistics for the subject membership, or <see langword="null"/> when no
    /// rich detail is available (Requirement 13.3, 13.4).
    /// </summary>
    /// <param name="squadId">The squad the statistics are scoped to.</param>
    /// <param name="membershipId">The subject membership whose rich statistics are read.</param>
    /// <param name="ct">A token that surfaces cancellation to the caller.</param>
    /// <returns>The rich statistics, or <see langword="null"/> when there is no data.</returns>
    Task<RichStats?> GetForMembershipAsync(Guid squadId, Guid membershipId, CancellationToken ct);

    /// <summary>
    /// Retrieves the identity of the squad's top scorer, or <see langword="null"/> when there is no
    /// rich detail to determine one (Requirement 13.3, 13.4).
    /// </summary>
    /// <param name="squadId">The squad whose top scorer is read.</param>
    /// <param name="ct">A token that surfaces cancellation to the caller.</param>
    /// <returns>The top scorer's membership identity, or <see langword="null"/> when there is no data.</returns>
    Task<Guid?> GetTopScorerAsync(Guid squadId, CancellationToken ct);
}
