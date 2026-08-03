using PitchMate.Domain.Matches;

namespace PitchMate.Application.Matches.Abstractions;

/// <summary>
/// Membership-rating persistence operations for reading and seeding the squad-scoped current rating
/// (μ, σ) that hangs off a <see cref="Domain.Squads.SquadMembership"/> one-to-one. Declared in
/// Application so use cases stay free of EF Core / Npgsql types; implemented in Infrastructure over
/// the <c>PitchMateDbContext</c> (Requirement 16.2, 19.4). Balancing reads current ratings, and
/// completion reads or seeds them before applying the single rating update (Requirement 12.1, 12.4).
/// </summary>
public interface IMembershipRatingRepository
{
    /// <summary>
    /// Retrieves the current rating hanging off <paramref name="squadMembershipId"/>, or
    /// <see langword="null"/> when the membership has no rating yet (before its first participation),
    /// so the caller can seed one from the membership's skill tier (Requirement 12.1).
    /// </summary>
    /// <param name="squadMembershipId">The squad membership whose current rating is read.</param>
    /// <param name="cancellationToken">A token that surfaces cancellation to the caller.</param>
    /// <returns>The membership's current rating, or <see langword="null"/> when none exists yet.</returns>
    Task<MembershipRating?> GetAsync(Guid squadMembershipId, CancellationToken cancellationToken);

    /// <summary>
    /// Stages an insert of <paramref name="rating"/>, seeding a membership's current rating on its
    /// first participation (Requirement 12.1). The row is written on the unit-of-work commit.
    /// </summary>
    /// <param name="rating">The membership rating to add.</param>
    /// <param name="cancellationToken">A token that surfaces cancellation to the caller.</param>
    Task AddAsync(MembershipRating rating, CancellationToken cancellationToken);
}
