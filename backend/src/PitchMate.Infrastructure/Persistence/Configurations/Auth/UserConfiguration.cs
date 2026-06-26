using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PitchMate.Domain.Auth;

namespace PitchMate.Infrastructure.Persistence.Configurations.Auth;

/// <summary>
/// Maps the <see cref="User"/> aggregate root. The shared <see cref="Domain.Common.BaseEntity"/>
/// conventions (uuid key, <c>xmin</c> concurrency token, soft-delete filter) and snake_case
/// table/column naming are applied centrally by <see cref="PitchMateDbContext"/>, so this
/// configuration only declares the User-specific columns and the owned
/// <see cref="User.Identities"/> relationship.
/// </summary>
internal sealed class UserConfiguration : IEntityTypeConfiguration<User>
{
    public void Configure(EntityTypeBuilder<User> builder)
    {
        builder.Property(u => u.DisplayName)
            .IsRequired()
            .HasMaxLength(100);

        // Email is stored normalised; the spec bounds total length at 254 characters.
        builder.Property(u => u.Email)
            .IsRequired()
            .HasMaxLength(254);

        builder.Property(u => u.EmailVerified)
            .IsRequired();

        builder.Property(u => u.AvatarReference)
            .HasMaxLength(2048);

        // A User owns many AuthIdentity rows; there is no inverse navigation on AuthIdentity
        // (it carries only the UserId), so the relationship is configured one-directionally.
        builder.HasMany(u => u.Identities)
            .WithOne()
            .HasForeignKey(identity => identity.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        // Read/write the owned identities through the backing field, never a public setter.
        builder.Metadata
            .FindNavigation(nameof(User.Identities))!
            .SetPropertyAccessMode(PropertyAccessMode.Field);
    }
}
