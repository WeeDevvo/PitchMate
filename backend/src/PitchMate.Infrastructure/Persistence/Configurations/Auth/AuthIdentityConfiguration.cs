using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PitchMate.Domain.Auth;

namespace PitchMate.Infrastructure.Persistence.Configurations.Auth;

/// <summary>
/// Maps the <see cref="AuthIdentity"/> entity. Resolution of an incoming authentication is
/// solely on the pair (<see cref="AuthIdentity.Provider"/>, <see cref="AuthIdentity.ProviderUserId"/>),
/// so that pair carries a unique index enforcing global uniqueness (Requirement 1.3). The
/// optional <see cref="AuthIdentity.Credential"/> is a one-to-one owned by this identity and
/// present only for the Password provider; its unique foreign key guarantees at most one
/// credential per identity (Requirements 1.7, 1.8).
/// </summary>
internal sealed class AuthIdentityConfiguration : IEntityTypeConfiguration<AuthIdentity>
{
    public void Configure(EntityTypeBuilder<AuthIdentity> builder)
    {
        // Persisted as the explicit, stable enum numeric value (int).
        builder.Property(identity => identity.Provider)
            .IsRequired();

        builder.Property(identity => identity.ProviderUserId)
            .IsRequired()
            .HasMaxLength(256);

        // Global uniqueness of the sole resolution key (Requirements 1.3, 1.10).
        builder.HasIndex(identity => new { identity.Provider, identity.ProviderUserId })
            .IsUnique();

        // Exactly one PasswordCredential per Password identity. PasswordCredential has no
        // inverse navigation, and the dependent's foreign key is unique by virtue of the
        // one-to-one relationship.
        builder.HasOne(identity => identity.Credential)
            .WithOne()
            .HasForeignKey<PasswordCredential>(credential => credential.AuthIdentityId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
