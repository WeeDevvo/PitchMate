namespace PitchMate.Application.Matches.Abstractions;

/// <summary>
/// The read-side source of one match's working-teams projection (match-read-models Requirement 4.18),
/// in a fixed number of round trips independent of the team and participant counts.
/// </summary>
public interface IWorkingTeamsSource
{
    /// <summary>
    /// Finds the working-teams projection of <paramref name="matchId"/>, or <see langword="null"/> when
    /// the match is absent or soft-deleted, or its squad is not visible (Requirement 5.10).
    /// </summary>
    /// <param name="matchId">The match to read.</param>
    /// <param name="cancellationToken">A token to cancel the read.</param>
    Task<WorkingTeamsProjection?> FindAsync(Guid matchId, CancellationToken cancellationToken);
}
