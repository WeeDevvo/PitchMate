using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PitchMate.Domain.Squads;

namespace PitchMate.Infrastructure.Persistence.Configurations.Squads;

/// <summary>
/// Maps the <see cref="SquadMembership"/> entity, the membership-centric row every later feature
/// (rating, stats, match history) hangs off. The database constraints declared here make the
/// domain invariants unbreakable under concurrency:
/// <list type="bullet">
/// <item>A <c>CHECK ((user_id IS NULL) = (role IS NULL))</c> mirrors the "exactly one backing"
/// invariant: a guest membership holds no role, a registered membership always does
/// (Requirement 2.2, 2.3).</item>
/// <item>A filtered unique index on <c>(squad_id, user_id)</c> allows at most one membership per
/// user per squad while exempting guest rows (Requirement 2.4, 2.5, 9.6, 11.9).</item>
/// <item>A filtered unique index on <c>(squad_id, display_name_normalized)</c> enforces
/// case-insensitive display-name uniqueness across active and inactive rows while exempting
/// anonymised rows (whose normalised key is null), freeing a name for reuse (Requirement 3.1–3.6,
/// 11.9).</item>
/// <item>A filtered unique index on <c>(squad_id) WHERE role = Owner</c> guarantees exactly one
/// owner per squad at every instant, including across an ownership transfer (Requirement 6.1).</item>
/// </list>
/// The shared <see cref="Domain.Common.BaseEntity"/> conventions and snake_case naming are applied
/// centrally by <see cref="PitchMateDbContext"/>.
/// </summary>
internal sealed class SquadMembershipConfiguration : IEntityTypeConfiguration<SquadMembership>
{
    public void Configure(EntityTypeBuilder<SquadMembership> builder)
    {
        builder.Property(membership => membership.SquadId)
            .IsRequired();

        // Null iff a guest membership (Requirement 2.2); the backing discriminator.
        builder.Property(membership => membership.UserId);

        // Persisted as the explicit, stable enum numeric value (int); null iff a guest membership
        // (Requirement 2.1, 4.1).
        builder.Property(membership => membership.Role);

        builder.Property(membership => membership.State)
            .IsRequired();

        builder.Property(membership => membership.DisplayName)
            .IsRequired()
            .HasMaxLength(SquadMembership.DisplayNameMaxLength);

        // Trimmed, lower-cased uniqueness key; null iff anonymised, exempting the row from the
        // filtered uniqueness index (Requirement 3.4, 18.1).
        builder.Property(membership => membership.DisplayNameNormalized)
            .HasMaxLength(SquadMembership.DisplayNameMaxLength);

        builder.Property(membership => membership.SkillTier);

        builder.Property(membership => membership.ClaimCompleted)
            .IsRequired();

        builder.Property(membership => membership.LawfulBasisAcknowledgedAt);

        // Backing invariant: guest (no user) ⇔ no role; registered (user) ⇔ role (Requirement 2.2, 2.3).
        builder.ToTable(table => table.HasCheckConstraint(
            "ck_squad_membership_backing",
            "(user_id IS NULL) = (role IS NULL)"));

        // One membership per user per squad; guest rows (null user) are exempt (Requirement 2.4, 2.5, 9.6, 11.9).
        builder.HasIndex(membership => new { membership.SquadId, membership.UserId })
            .IsUnique()
            .HasFilter("user_id IS NOT NULL");

        // Case-insensitive display-name uniqueness across active and inactive rows; anonymised rows
        // (null normalised key) are exempt so a freed name can be reused (Requirement 3.1–3.6, 11.9).
        builder.HasIndex(membership => new { membership.SquadId, membership.DisplayNameNormalized })
            .IsUnique()
            .HasFilter("display_name_normalized IS NOT NULL");

        // Exactly one Owner per squad at every instant (Requirement 6.1). Role is stored as its int
        // value; Owner is the filter predicate.
        builder.HasIndex(membership => membership.SquadId)
            .IsUnique()
            .HasFilter($"role = {(int)SquadRole.Owner}")
            .HasDatabaseName("ix_squad_membership_squad_id_owner");
    }
}
