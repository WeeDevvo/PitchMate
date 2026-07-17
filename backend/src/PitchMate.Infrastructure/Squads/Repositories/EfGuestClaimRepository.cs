using Microsoft.EntityFrameworkCore;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Squads;
using PitchMate.Infrastructure.Persistence;

namespace PitchMate.Infrastructure.Squads.Repositories;

/// <summary>
/// EF Core implementation of <see cref="IGuestClaimRepository"/> over the shared
/// <see cref="PitchMateDbContext"/>. Resolves the single in-flight claim for a membership so
/// consent and completion act on it; an <em>open</em> claim is one still in
/// <see cref="GuestClaimState.Pending"/> or <see cref="GuestClaimState.Consented"/> (not yet
/// completed or reversed).
/// <para>Validates: Requirements 15.1, 15.3, 15.5, 19.3.</para>
/// </summary>
internal sealed class EfGuestClaimRepository(PitchMateDbContext db) : IGuestClaimRepository
{
    /// <inheritdoc />
    public async Task AddAsync(GuestClaim claim, CancellationToken cancellationToken)
        => await db.Set<GuestClaim>().AddAsync(claim, cancellationToken);

    /// <inheritdoc />
    public Task<GuestClaim?> GetOpenForMembershipAsync(Guid membershipId, CancellationToken cancellationToken)
        // Open == not yet completed or reversed, i.e. Pending or Consented. A membership has at most
        // one such claim in flight at a time (Requirement 15.1, 15.3, 15.5).
        => db.Set<GuestClaim>()
            .FirstOrDefaultAsync(
                claim => claim.MembershipId == membershipId
                    && (claim.State == GuestClaimState.Pending || claim.State == GuestClaimState.Consented),
                cancellationToken);
}
