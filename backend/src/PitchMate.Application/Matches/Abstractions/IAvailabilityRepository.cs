using PitchMate.Domain.Matches;

namespace PitchMate.Application.Matches.Abstractions;

/// <summary>
/// Availability-response persistence operations that must run inside the database (per-membership
/// response lookup, upsert/clear, and the per-match response scan behind the availability tally).
/// Declared in Application so use cases stay free of EF Core / Npgsql types; implemented in
/// Infrastructure over the <c>PitchMateDbContext</c> (Requirement 16.2, 19.3). A membership holds at
/// most one response per match: presence of a stored response — even one marking an empty subset of
/// candidate days — is distinct from its absence (Requirement 4.2, 4.7).
/// </summary>
public interface IAvailabilityRepository
{
    /// <summary>
    /// Retrieves the stored availability response for <paramref name="squadMembershipId"/> against
    /// <paramref name="matchId"/>, or <see langword="null"/> when the membership has no stored response
    /// (Requirement 4.2). A returned response marking an empty subset is distinct from
    /// <see langword="null"/> (Requirement 4.7).
    /// </summary>
    /// <param name="matchId">The match the response belongs to.</param>
    /// <param name="squadMembershipId">The responding squad membership.</param>
    /// <param name="cancellationToken">A token that surfaces cancellation to the caller.</param>
    /// <returns>The stored response, or <see langword="null"/> when none is stored.</returns>
    Task<AvailabilityResponse?> GetResponseAsync(Guid matchId, Guid squadMembershipId, CancellationToken cancellationToken);

    /// <summary>
    /// Stages the insert-or-replace of <paramref name="response"/>, so the responding membership
    /// retains exactly one stored response equal to this latest submission (Requirement 4.1, 4.2). The
    /// row is written on the unit-of-work commit.
    /// </summary>
    /// <param name="response">The response to store, replacing any prior response for the same membership.</param>
    /// <param name="cancellationToken">A token that surfaces cancellation to the caller.</param>
    Task UpsertAsync(AvailabilityResponse response, CancellationToken cancellationToken);

    /// <summary>
    /// Stages the removal of <paramref name="response"/>, clearing the membership's stored response so
    /// it reverts to having none (Requirement 4.3). The removal is applied on the unit-of-work commit.
    /// </summary>
    /// <param name="response">The stored response to clear.</param>
    /// <param name="cancellationToken">A token that surfaces cancellation to the caller.</param>
    Task RemoveAsync(AvailabilityResponse response, CancellationToken cancellationToken);

    /// <summary>
    /// Lists every stored availability response for <paramref name="matchId"/>, so the availability
    /// tally can be computed over them (Requirement 5.1). Returns an empty list when none are stored.
    /// </summary>
    /// <param name="matchId">The match whose responses are listed.</param>
    /// <param name="cancellationToken">A token that surfaces cancellation to the caller.</param>
    /// <returns>The match's stored responses, or an empty list.</returns>
    Task<IReadOnlyList<AvailabilityResponse>> ListResponsesAsync(Guid matchId, CancellationToken cancellationToken);
}
