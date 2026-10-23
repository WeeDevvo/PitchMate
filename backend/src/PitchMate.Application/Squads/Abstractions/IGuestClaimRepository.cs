using PitchMate.Domain.Squads;

namespace PitchMate.Application.Squads.Abstractions;

/// <summary>Persistence for <see cref="GuestClaim"/> audit records.</summary>
public interface IGuestClaimRepository
{
    /// <summary>Stages a new claim for the unit of work's next save.</summary>
    Task AddAsync(GuestClaim claim, CancellationToken cancellationToken);

    /// <summary>
    /// The membership's open claim (issued or accepted), or <see langword="null"/>. A membership has at
    /// most one open claim, because issuing a new link cancels the old one.
    /// </summary>
    Task<GuestClaim?> GetOpenForMembershipAsync(Guid membershipId, CancellationToken cancellationToken);

    /// <summary>The claim whose link secret hashes to <paramref name="tokenHash"/>, in any state, or <see langword="null"/>.</summary>
    Task<GuestClaim?> FindByTokenHashAsync(string tokenHash, CancellationToken cancellationToken);

    /// <summary>
    /// The membership's most recently completed claim that has not been reversed, or
    /// <see langword="null"/>. This is the claim a reversal marks.
    /// </summary>
    Task<GuestClaim?> GetLatestCompletedForMembershipAsync(Guid membershipId, CancellationToken cancellationToken);

    /// <summary>Every open claim (issued or accepted) for memberships of <paramref name="squadId"/>.</summary>
    Task<IReadOnlyList<GuestClaim>> ListOpenForSquadAsync(Guid squadId, CancellationToken cancellationToken);
}
