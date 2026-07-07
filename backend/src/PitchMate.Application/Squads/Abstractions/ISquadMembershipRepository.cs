using PitchMate.Domain.Squads;

namespace PitchMate.Application.Squads.Abstractions;

/// <summary>
/// Membership-specific persistence operations that must run inside the database (acting-membership
/// resolution, owner resolution, case-insensitive display-name uniqueness scans). Declared in
/// Application; implemented in Infrastructure over the <c>PitchMateDbContext</c> (Requirement 19.2, 19.3).
/// </summary>
public interface ISquadMembershipRepository
{
    /// <summary>Stages an insert of <paramref name="membership"/>; the row is written on the unit-of-work commit.</summary>
    /// <param name="membership">The membership to add.</param>
    /// <param name="cancellationToken">A token that surfaces cancellation to the caller.</param>
    Task AddAsync(SquadMembership membership, CancellationToken cancellationToken);

    /// <summary>
    /// Retrieves the membership whose identity equals <paramref name="membershipId"/>, or
    /// <see langword="null"/> when none matches (Requirement 2.4).
    /// </summary>
    /// <param name="membershipId">The membership identity to look up.</param>
    /// <param name="cancellationToken">A token that surfaces cancellation to the caller.</param>
    /// <returns>The matching membership, or <see langword="null"/>.</returns>
    Task<SquadMembership?> GetByIdAsync(Guid membershipId, CancellationToken cancellationToken);

    /// <summary>
    /// Resolves the acting membership for <paramref name="userId"/> in <paramref name="squadId"/> so
    /// authorisation can gate on its role and state, or <see langword="null"/> when the user holds no
    /// membership there (Requirement 2.4, 9.6, 11.3, 16.4).
    /// </summary>
    /// <param name="userId">The backing user.</param>
    /// <param name="squadId">The squad.</param>
    /// <param name="cancellationToken">A token that surfaces cancellation to the caller.</param>
    /// <returns>The user's membership in the squad, or <see langword="null"/>.</returns>
    Task<SquadMembership?> GetByUserAndSquadAsync(Guid userId, Guid squadId, CancellationToken cancellationToken);

    /// <summary>
    /// Lists the memberships of <paramref name="squadId"/>, optionally restricted to active ones when
    /// <paramref name="activeOnly"/> is <see langword="true"/> (Requirement 16.4). Returns an empty
    /// list when none match.
    /// </summary>
    /// <param name="squadId">The squad whose memberships are listed.</param>
    /// <param name="activeOnly">When <see langword="true"/>, only active memberships are returned.</param>
    /// <param name="cancellationToken">A token that surfaces cancellation to the caller.</param>
    /// <returns>The squad's memberships, or an empty list.</returns>
    Task<IReadOnlyList<SquadMembership>> ListForSquadAsync(Guid squadId, bool activeOnly, CancellationToken cancellationToken);

    /// <summary>
    /// Retrieves the squad's single owner membership, or <see langword="null"/> when none exists
    /// (Requirement 6.1, 17.5). The single-owner invariant is enforced by a filtered unique index.
    /// </summary>
    /// <param name="squadId">The squad whose owner is resolved.</param>
    /// <param name="cancellationToken">A token that surfaces cancellation to the caller.</param>
    /// <returns>The owner membership, or <see langword="null"/>.</returns>
    Task<SquadMembership?> GetOwnerAsync(Guid squadId, CancellationToken cancellationToken);

    /// <summary>
    /// Determines whether another non-anonymised membership in <paramref name="squadId"/> already
    /// holds the normalised (trimmed, lower-cased) display name <paramref name="normalisedName"/>,
    /// optionally excluding the membership identified by <paramref name="excludingMembershipId"/> so a
    /// rename or reactivation does not collide with itself (Requirement 3.1, 3.2, 3.3).
    /// </summary>
    /// <param name="squadId">The squad in which uniqueness is scoped.</param>
    /// <param name="normalisedName">The normalised display name to test.</param>
    /// <param name="excludingMembershipId">A membership to exclude from the scan, or <see langword="null"/>.</param>
    /// <param name="cancellationToken">A token that surfaces cancellation to the caller.</param>
    /// <returns><see langword="true"/> when the normalised name is already taken; otherwise <see langword="false"/>.</returns>
    Task<bool> DisplayNameTakenAsync(Guid squadId, string normalisedName, Guid? excludingMembershipId, CancellationToken cancellationToken);
}
