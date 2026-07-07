namespace PitchMate.Application.Squads.Abstractions;

/// <summary>
/// Answers whether a membership carries at least one match-history link. This spec does not yet own
/// the match entities, so erasure depends only on this abstraction to branch anonymise-vs-remove: a
/// membership with match history is anonymised (its de-identified row retained so immutable matches
/// and rating replay stay valid), while one with no history is hard-removed (Requirement 18.1, 18.2).
/// The match-lifecycle spec implements this over its own tables; this spec registers a conservative
/// default in Infrastructure until then.
/// </summary>
public interface IMembershipHistoryProbe
{
    /// <summary>
    /// Determines whether the membership identified by <paramref name="membershipId"/> is linked to
    /// any match history (Requirement 18.1, 18.2).
    /// </summary>
    /// <param name="membershipId">The membership to probe.</param>
    /// <param name="cancellationToken">A token that surfaces cancellation to the caller.</param>
    /// <returns><see langword="true"/> when the membership carries match history; otherwise <see langword="false"/>.</returns>
    Task<bool> HasMatchHistoryAsync(Guid membershipId, CancellationToken cancellationToken);
}
