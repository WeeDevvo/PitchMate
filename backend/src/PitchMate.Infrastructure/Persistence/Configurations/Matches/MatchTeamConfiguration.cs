using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PitchMate.Domain.Matches;

namespace PitchMate.Infrastructure.Persistence.Configurations.Matches;

/// <summary>
/// Maps the <see cref="MatchTeam"/> entity — one working side while teams are being rolled, with a
/// name, a bib flag, and an ordered roster of participant squad-membership identities. The
/// relationship to the owning <see cref="Match"/> (the <c>MatchId</c> foreign key) is configured
/// from the match side; this configuration declares the team's own columns and its roster.
/// <para>
/// The ordered <see cref="MatchTeam.Roster"/> is a primitive collection of GUIDs; on PostgreSQL the
/// Npgsql provider maps a scalar collection to a native <c>uuid[]</c> array column, preserving order.
/// It is read/written through its backing field. The shared <see cref="Domain.Common.BaseEntity"/>
/// conventions and snake_case naming are applied centrally by <see cref="PitchMateDbContext"/>.
/// </para>
/// </summary>
internal sealed class MatchTeamConfiguration : IEntityTypeConfiguration<MatchTeam>
{
    public void Configure(EntityTypeBuilder<MatchTeam> builder)
    {
        builder.Property(team => team.MatchId)
            .IsRequired();

        // Trimmed team name; 1..50 characters at lock, not null (Requirement 8.5).
        builder.Property(team => team.TeamName)
            .IsRequired()
            .HasMaxLength(Match.TeamNameMaxLength);

        builder.Property(team => team.BibFlag)
            .IsRequired();

        // Ordered roster of participant membership identities, stored as a native uuid[] array.
        builder.PrimitiveCollection(team => team.Roster)
            .HasColumnName("roster");
        builder.Metadata
            .FindProperty(nameof(MatchTeam.Roster))!
            .SetPropertyAccessMode(PropertyAccessMode.Field);

        builder.HasIndex(team => team.MatchId);
    }
}
