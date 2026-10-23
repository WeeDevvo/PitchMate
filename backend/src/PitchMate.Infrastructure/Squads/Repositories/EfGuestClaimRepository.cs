using Microsoft.EntityFrameworkCore;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Squads;
using PitchMate.Infrastructure.Persistence;

namespace PitchMate.Infrastructure.Squads.Repositories;

/// <summary>EF Core implementation of <see cref="IGuestClaimRepository"/>.</summary>
internal sealed class EfGuestClaimRepository(PitchMateDbContext db) : IGuestClaimRepository
{
    public async Task AddAsync(GuestClaim claim, CancellationToken cancellationToken)
        => await db.Set<GuestClaim>().AddAsync(claim, cancellationToken);

    public Task<GuestClaim?> GetOpenForMembershipAsync(Guid membershipId, CancellationToken cancellationToken)
        // Open == issued or accepted. Issuing a new link cancels the old one, so there is at most one.
        => db.Set<GuestClaim>()
            .FirstOrDefaultAsync(
                claim => claim.MembershipId == membershipId
                    && (claim.State == GuestClaimState.Pending || claim.State == GuestClaimState.Consented),
                cancellationToken);

    public Task<GuestClaim?> FindByTokenHashAsync(string tokenHash, CancellationToken cancellationToken)
        // token_hash is unique, so this is a point lookup on its index.
        => db.Set<GuestClaim>()
            .FirstOrDefaultAsync(claim => claim.TokenHash == tokenHash, cancellationToken);

    public Task<GuestClaim?> GetLatestCompletedForMembershipAsync(
        Guid membershipId,
        CancellationToken cancellationToken)
        => db.Set<GuestClaim>()
            .Where(claim => claim.MembershipId == membershipId && claim.State == GuestClaimState.Completed)
            .OrderByDescending(claim => claim.CompletedAt)
            .ThenByDescending(claim => claim.Id)
            .FirstOrDefaultAsync(cancellationToken);

    public async Task<IReadOnlyList<GuestClaim>> ListOpenForSquadAsync(
        Guid squadId,
        CancellationToken cancellationToken)
        => await db.Set<GuestClaim>()
            .Where(claim => (claim.State == GuestClaimState.Pending || claim.State == GuestClaimState.Consented)
                && db.Set<SquadMembership>().Any(membership =>
                    membership.Id == claim.MembershipId && membership.SquadId == squadId))
            .OrderBy(claim => claim.Id)
            .ToListAsync(cancellationToken);
}
