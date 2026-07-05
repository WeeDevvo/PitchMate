using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PitchMate.Domain.Auth;

namespace PitchMate.Infrastructure.Persistence.Configurations.Auth;

/// <summary>
/// Maps the <see cref="PasswordCredential"/> entity. Only the one-way, salted
/// <see cref="PasswordCredential.PasswordHash"/> is stored; no plaintext or recoverable form
/// is ever persisted (Requirement 2.2). The unique foreign key to <see cref="AuthIdentity"/>
/// is configured on the owning <see cref="AuthIdentityConfiguration"/> one-to-one relationship.
/// </summary>
internal sealed class PasswordCredentialConfiguration : IEntityTypeConfiguration<PasswordCredential>
{
    public void Configure(EntityTypeBuilder<PasswordCredential> builder)
    {
        builder.Property(credential => credential.AuthIdentityId)
            .IsRequired();

        // Encodes algorithm, salt, and work factor; the framework hasher's encoded form is
        // comfortably within this bound.
        builder.Property(credential => credential.PasswordHash)
            .IsRequired()
            .HasMaxLength(512);
    }
}
