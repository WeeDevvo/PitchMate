using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PitchMate.Domain.Squads;

namespace PitchMate.Infrastructure.Persistence.Configurations.Squads;

/// <summary>
/// Maps the <see cref="Squad"/> aggregate root. The shared <see cref="Domain.Common.BaseEntity"/>
/// conventions (uuid key, <c>xmin</c> concurrency token, and the global soft-delete query filter
/// that keeps pending-deletion squads out of default reads — Requirement 16.4, 17.3) and
/// snake_case table/column naming are applied centrally by <see cref="PitchMateDbContext"/>, so
/// this configuration declares only the Squad-specific columns, the owned
/// <see cref="Squad.Features"/> collection, and the <see cref="Squad.Memberships"/> relationship.
/// </summary>
internal sealed class SquadConfiguration : IEntityTypeConfiguration<Squad>
{
    public void Configure(EntityTypeBuilder<Squad> builder)
    {
        builder.Property(squad => squad.Name)
            .IsRequired()
            .HasMaxLength(Squad.NameMaxLength);

        // Set only while the squad is pending deletion (Requirement 17.1); null otherwise.
        builder.Property(squad => squad.PurgeAt);

        // One SquadFeatureFlag row per feature, keyed on (SquadId, Feature) so every squad holds
        // exactly one flag per SquadFeature member (Requirement 13.1). Read/written through the
        // backing field, never a public setter.
        builder.OwnsMany(squad => squad.Features, flag =>
        {
            flag.ToTable("squad_feature_flag");
            flag.WithOwner().HasForeignKey("SquadId");
            flag.Property<Guid>("SquadId");
            flag.HasKey("SquadId", nameof(SquadFeatureFlag.Feature));

            flag.Property(f => f.Feature)
                .IsRequired();
            flag.Property(f => f.IsEnabled)
                .IsRequired();
        });
        builder.Metadata
            .FindNavigation(nameof(Squad.Features))!
            .SetPropertyAccessMode(PropertyAccessMode.Field);

        // A squad owns many memberships; SquadMembership carries only the SquadId (no inverse
        // navigation), so the relationship is configured one-directionally and read/written through
        // the backing field.
        //
        // ClientNoAction (not Cascade, and not Restrict): the purge and erasure use cases own the
        // deletion policy for memberships and apply it explicitly — a membership carrying match
        // history is anonymised and its de-identified row retained so chronological rating replay
        // stays valid (Requirement 18.1, 18.7), while only a membership with no history is
        // permanently removed (Requirement 18.2). A database ON DELETE CASCADE would silently delete
        // those anonymised-and-retained rows when the squad is hard-deleted during purge
        // (Requirement 17.5), destroying exactly the replay inputs the design requires be kept, so
        // the database must never implicitly remove a membership row (the FK emits NO ACTION).
        //
        // ClientNoAction additionally suppresses EF Core's *client-side* relationship fixup: with
        // Restrict, marking a squad for (soft-)deletion while its owner membership is tracked in the
        // same context makes EF try to sever that required relationship and throw before the save
        // pipeline can reinterpret the delete as a soft-delete. Since the squad soft-delete keeps the
        // row (and purge deletes memberships explicitly first), no real cascade is ever needed, so
        // telling EF to take no client action is both correct and keeps the fail-safe DB behaviour.
        builder.HasMany(squad => squad.Memberships)
            .WithOne()
            .HasForeignKey(membership => membership.SquadId)
            .OnDelete(DeleteBehavior.ClientNoAction);
        builder.Metadata
            .FindNavigation(nameof(Squad.Memberships))!
            .SetPropertyAccessMode(PropertyAccessMode.Field);
    }
}
