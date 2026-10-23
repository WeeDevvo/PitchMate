using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PitchMate.Domain.Squads;

namespace PitchMate.Infrastructure.Persistence.Configurations.Squads;

/// <summary>
/// Maps the <see cref="GuestClaim"/> audit record linking a guest <see cref="SquadMembership"/> to
/// a registered user through a one-time claim link. Only the link secret's one-way
/// <see cref="GuestClaim.TokenHash"/> is persisted, uniquely indexed so a presented secret resolves to
/// at most one claim; the target user stays null until someone accepts the link. The initiating admin and
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

        // Unknown until a player accepts the link.
        builder.Property(claim => claim.TargetUserId);

        builder.Property(claim => claim.TokenHash)
            .IsRequired()
            .HasMaxLength(64);

        builder.Property(claim => claim.ExpiresAt)
            .IsRequired();

        builder.Property(claim => claim.State)
            .IsRequired();

        builder.Property(claim => claim.ConsentAt);
        builder.Property(claim => claim.CompletedAt);
        builder.Property(claim => claim.ReversedAt);
        builder.Property(claim => claim.CancelledAt);

        // A presented secret is matched by its hash, which must resolve to at most one claim.
        builder.HasIndex(claim => claim.TokenHash)
            .IsUnique();

        // Resolve an open claim for a membership.
        builder.HasIndex(claim => claim.MembershipId);

        builder.HasOne<SquadMembership>()
            .WithMany()
            .HasForeignKey(claim => claim.MembershipId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
