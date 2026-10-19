namespace PitchMate.Application.Matches.Abstractions;

/// <summary>
/// The read-side source of one match's detail projection (match-read-models Requirement 2.12). It
/// composes the match header, its candidate and confirmed days, its participants — display names
/// already resolved by <c>ParticipantDisplayName.Resolve</c>, in ascending roster-position order — and
/// its recorded result and completion instant, in a number of round trips independent of the
/// participant and candidate-day counts.
/// </summary>
public interface IMatchDetailSource
{
    /// <summary>
    /// Finds the detail projection of <paramref name="matchId"/>, or <see langword="null"/> when the
    /// match is absent or soft-deleted, <b>or its squad is not visible</b> (Requirement 5.10) — the
    /// caller refuses all of these identically.
    /// </summary>
    /// <param name="matchId">The match to read.</param>
    /// <param name="cancellationToken">A token to cancel the read.</param>
    Task<MatchDetailProjection?> FindAsync(Guid matchId, CancellationToken cancellationToken);
}
