using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PitchMate.Domain.Auth;

namespace PitchMate.Infrastructure.Persistence.Configurations.Auth;

/// <summary>
/// Maps the <see cref="EmailVerificationToken"/> entity. Only the one-way
/// <see cref="EmailVerificationToken.TokenHash"/> is persisted (Requirement 4.7); it is
/// indexed for redemption lookups. <see cref="EmailVerificationToken.RedeemedAt"/> is
/// nullable, marking an unredeemed token.
/// </summary>
internal sealed class EmailVerificationTokenConfiguration : IEntityTypeConfiguration<EmailVerificationToken>
{
    public void Configure(EntityTypeBuilder<EmailVerificationToken> builder)
    {
        builder.Property(token => token.UserId)
            .IsRequired();

        builder.Property(token => token.TokenHash)
            .IsRequired()
            .HasMaxLength(128);

        builder.Property(token => token.ExpiresAt)
            .IsRequired();

        // Presented tokens are resolved by hash; not unique (a superseded and a fresh token
        // are distinct rows), but indexed for the lookup.
        builder.HasIndex(token => token.TokenHash);

        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(token => token.UserId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
