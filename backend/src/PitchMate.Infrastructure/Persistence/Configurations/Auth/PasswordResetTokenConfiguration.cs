using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PitchMate.Domain.Auth;

namespace PitchMate.Infrastructure.Persistence.Configurations.Auth;

/// <summary>
/// Maps the <see cref="PasswordResetToken"/> entity, which authorises a reset on a Password
/// <see cref="AuthIdentity"/>. Only the one-way <see cref="PasswordResetToken.TokenHash"/> is
/// persisted (Requirement 5.9); it is indexed for redemption lookups.
/// <see cref="PasswordResetToken.RedeemedAt"/> is nullable, marking an unredeemed token.
/// </summary>
internal sealed class PasswordResetTokenConfiguration : IEntityTypeConfiguration<PasswordResetToken>
{
    public void Configure(EntityTypeBuilder<PasswordResetToken> builder)
    {
        builder.Property(token => token.AuthIdentityId)
            .IsRequired();

        builder.Property(token => token.TokenHash)
            .IsRequired()
            .HasMaxLength(128);

        builder.Property(token => token.ExpiresAt)
            .IsRequired();

        // Presented tokens are resolved by hash; not unique, but indexed for the lookup.
        builder.HasIndex(token => token.TokenHash);

        builder.HasOne<AuthIdentity>()
            .WithMany()
            .HasForeignKey(token => token.AuthIdentityId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
