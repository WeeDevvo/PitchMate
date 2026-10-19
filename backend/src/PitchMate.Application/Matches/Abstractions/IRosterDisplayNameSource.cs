namespace PitchMate.Application.Matches.Abstractions;

/// <summary>
/// Resolves the display-name-at-time of every membership that plays in a match, by the single
/// <c>ParticipantDisplayName.Resolve</c> rule over the membership's <b>current</b> state, so the team
/// sheet reports an anonymised membership as the placeholder rather than the name captured at addition
/// (match-read-models Requirement 10.7).
/// </summary>
public interface IRosterDisplayNameSource
{
    /// <summary>
    /// The resolved display name of each of the match's participants, keyed by squad-membership
    /// identity. A rostered identity with no participant is absent, which the Domain resolves to the
    /// placeholder.
    /// </summary>
    /// <param name="matchId">The match whose participants are resolved.</param>
    /// <param name="cancellationToken">A token to cancel the read.</param>
    Task<IReadOnlyDictionary<Guid, string>> ListForMatchAsync(Guid matchId, CancellationToken cancellationToken);
}
