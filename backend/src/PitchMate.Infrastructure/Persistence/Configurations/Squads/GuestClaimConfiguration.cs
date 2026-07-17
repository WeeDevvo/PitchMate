using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PitchMate.Domain.Squads;

namespace PitchMate.Infrastructure.Persistence.Configurations.Squads;

/// <summary>
/// Maps the <see cref="GuestClaim"/> audit record linking a guest <see cref="SquadMembership"/> to
/// a registered user through its consent-gated, reversible lifecycle. The initiating admin and
/// initiation instant are captured via the shared <see cref="Domain.Common.BaseEntity"/> audit
/// fields (<c>CreatedBy</c>/<c>CreatedAt</c>); the state instants complete the trail
/// (Requirement 15.5, 15.6). The shared conventions and snake_case naming are applied centrally by
/// <see cref="PitchMateDbContext"/>.
/// </summary>
internal sealed class GuestClaimConfiguration : IEntityTypeConfiguration<GuestClaim>
{
    public void Configure(EntityTypeBuilder<GuestClaim> builder)
    {
        builder.Property(claim => claim.MembershipId)
            .IsRequired();

        builder.Property(claim => claim.TargetUserId)
            .IsRequired();

        builder.Property(claim => claim.State)
            .IsRequired();

        builder.Property(claim => claim.ConsentAt);
        builder.Property(claim => claim.CompletedAt);
        builder.Property(claim => claim.ReversedAt);

        // Resolve an open claim for a membership.
        builder.HasIndex(claim => claim.MembershipId);

        builder.HasOne<SquadMembership>()
            .WithMany()
            .HasForeignKey(claim => claim.MembershipId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
