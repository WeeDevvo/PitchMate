using PitchMate.Domain.Squads;

namespace PitchMate.Application.Squads.Abstractions;

/// <summary>
/// Guest-claim persistence operations. Declared in Application; implemented in Infrastructure over
/// the <c>PitchMateDbContext</c> (Requirement 19.2, 19.3). A <see cref="GuestClaim"/> is the audit
/// record for a consent-gated, reversible rebind of a guest membership onto a registered user.
/// </summary>
public interface IGuestClaimRepository
{
    /// <summary>Stages an insert of <paramref name="claim"/>; the row is written on the unit-of-work commit.</summary>
    /// <param name="claim">The guest claim to add.</param>
    /// <param name="cancellationToken">A token that surfaces cancellation to the caller.</param>
    Task AddAsync(GuestClaim claim, CancellationToken cancellationToken);

    /// <summary>
    /// Retrieves the open (not yet completed or reversed) claim for the membership identified by
    /// <paramref name="membershipId"/>, so consent and completion act on the in-flight claim, or
    /// <see langword="null"/> when there is none (Requirement 15.1, 15.3, 15.5).
    /// </summary>
    /// <param name="membershipId">The guest membership whose open claim is resolved.</param>
    /// <param name="cancellationToken">A token that surfaces cancellation to the caller.</param>
    /// <returns>The open claim for the membership, or <see langword="null"/>.</returns>
    Task<GuestClaim?> GetOpenForMembershipAsync(Guid membershipId, CancellationToken cancellationToken);
}
