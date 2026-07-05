using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PitchMate.Domain.Auth;

namespace PitchMate.Infrastructure.Persistence.Configurations.Auth;

/// <summary>
/// Maps the <see cref="RefreshToken"/> revocation-store row. Only the one-way
/// <see cref="RefreshToken.TokenHash"/> is persisted, and it carries a unique index so a
/// presented token resolves to at most one row (Requirements 9.1, 9.6). Tokens are grouped
/// by <see cref="RefreshToken.TokenFamilyId"/>, which is indexed for whole-family revocation.
/// </summary>
internal sealed class RefreshTokenConfiguration : IEntityTypeConfiguration<RefreshToken>
{
    public void Configure(EntityTypeBuilder<RefreshToken> builder)
    {
        builder.Property(token => token.UserId)
            .IsRequired();

        builder.Property(token => token.TokenFamilyId)
            .IsRequired();

        builder.Property(token => token.TokenHash)
            .IsRequired()
            .HasMaxLength(128);

        // Persisted as the explicit, stable enum numeric value (int).
        builder.Property(token => token.Status)
            .IsRequired();

        builder.Property(token => token.ExpiresAt)
            .IsRequired();

        // A presented refresh token is matched by its hash, which must be globally unique
        // (Requirement 9.6).
        builder.HasIndex(token => token.TokenHash)
            .IsUnique();

        // Whole-family revocation on reuse detection / sign-out queries by family id.
        builder.HasIndex(token => token.TokenFamilyId);

        builder.HasOne<User>()
            .WithMany()
            .HasForeignKey(token => token.UserId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
