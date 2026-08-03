using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PitchMate.Domain.Matches;
using PitchMate.Domain.Squads;

namespace PitchMate.Infrastructure.Persistence.Configurations.Matches;

/// <summary>
/// Maps the <see cref="MembershipRating"/> entity — the squad-scoped current rating (μ, σ) that
/// hangs off a single <see cref="SquadMembership"/> in a one-to-one relationship
/// (Requirement 12.1). Modelled as a separate entity keyed on the membership so match-lifecycle owns
/// its rating state without reaching into the squads aggregate's row.
/// <para>
/// A unique foreign key to <see cref="SquadMembership"/> enforces the one-to-one relationship: a
/// membership holds at most one current rating. The relationship never implicitly removes a rating
/// row (rating history must survive for replay), so it emits NO ACTION. The shared
/// <see cref="Domain.Common.BaseEntity"/> conventions and snake_case naming are applied centrally by
/// <see cref="PitchMateDbContext"/>.
/// </para>
/// </summary>
internal sealed class MembershipRatingConfiguration : IEntityTypeConfiguration<MembershipRating>
{
    public void Configure(EntityTypeBuilder<MembershipRating> builder)
    {
        builder.Property(rating => rating.SquadMembershipId)
            .IsRequired();

        builder.Property(rating => rating.Mu)
            .IsRequired();

        builder.Property(rating => rating.Sigma)
            .IsRequired();

        // One current rating per membership, one-to-one (Requirement 12.1).
        builder.HasIndex(rating => rating.SquadMembershipId)
            .IsUnique();

        builder.HasOne<SquadMembership>()
            .WithOne()
            .HasForeignKey<MembershipRating>(rating => rating.SquadMembershipId)
            .OnDelete(DeleteBehavior.ClientNoAction);
    }
}
