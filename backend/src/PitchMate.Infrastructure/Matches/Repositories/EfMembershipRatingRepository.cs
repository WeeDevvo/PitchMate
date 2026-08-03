using Microsoft.EntityFrameworkCore;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Domain.Matches;
using PitchMate.Infrastructure.Persistence;

namespace PitchMate.Infrastructure.Matches.Repositories;

/// <summary>
/// EF Core implementation of <see cref="IMembershipRatingRepository"/> over the shared
/// <see cref="PitchMateDbContext"/>. Reads the squad-scoped current rating (μ, σ) that hangs off a
/// <see cref="Domain.Squads.SquadMembership"/> one-to-one, and stages the seed row written on its
/// first participation (Requirement 12.1). Balancing reads current ratings and completion reads or
/// seeds them before applying the single rating update; neither performs rating arithmetic here.
/// <para>Validates: Requirements 16.3, 12.1.</para>
/// </summary>
internal sealed class EfMembershipRatingRepository(PitchMateDbContext db) : IMembershipRatingRepository
{
    /// <inheritdoc />
    public Task<MembershipRating?> GetAsync(Guid squadMembershipId, CancellationToken cancellationToken)
        // The unique index on SquadMembershipId guarantees at most one current rating per membership,
        // returning null before the membership's first participation so the caller can seed one.
        => db.Set<MembershipRating>()
            .FirstOrDefaultAsync(
                rating => rating.SquadMembershipId == squadMembershipId,
                cancellationToken);

    /// <inheritdoc />
    public async Task AddAsync(MembershipRating rating, CancellationToken cancellationToken)
        => await db.Set<MembershipRating>().AddAsync(rating, cancellationToken);
}
