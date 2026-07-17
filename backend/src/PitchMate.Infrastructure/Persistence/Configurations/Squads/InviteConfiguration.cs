using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PitchMate.Domain.Squads;

namespace PitchMate.Infrastructure.Persistence.Configurations.Squads;

/// <summary>
/// Maps the <see cref="Invite"/> entity. Only the one-way <see cref="Invite.TokenHash"/> is
/// persisted; it carries a unique index so a presented secret hashes to at most one invite and the
/// redeemable secret can never be reconstructed from storage (Requirement 10.4). The stored
/// <see cref="Invite.State"/> is only <c>Active</c>/<c>Revoked</c> — <c>Expired</c> is derived
/// against the clock and never persisted. The shared <see cref="Domain.Common.BaseEntity"/>
/// conventions and snake_case naming are applied centrally by <see cref="PitchMateDbContext"/>.
/// </summary>
internal sealed class InviteConfiguration : IEntityTypeConfiguration<Invite>
{
    public void Configure(EntityTypeBuilder<Invite> builder)
    {
        builder.Property(invite => invite.SquadId)
            .IsRequired();

        // Base64-encoded SHA-256 digest (44 chars); bounded generously.
        builder.Property(invite => invite.TokenHash)
            .IsRequired()
            .HasMaxLength(64);

        builder.Property(invite => invite.State)
            .IsRequired();

        // Null for a non-expiring invite (Requirement 12.6).
        builder.Property(invite => invite.ExpiresAt);

        // A presented secret is matched by its hash, which must resolve to at most one invite
        // (Requirement 10.4).
        builder.HasIndex(invite => invite.TokenHash)
            .IsUnique();

        // Active-invite counting and per-squad listing scan by squad.
        builder.HasIndex(invite => invite.SquadId);

        builder.HasOne<Squad>()
            .WithMany()
            .HasForeignKey(invite => invite.SquadId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
