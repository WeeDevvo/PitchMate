using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PitchMate.Domain.Matches;

namespace PitchMate.Infrastructure.Persistence.Configurations.Matches;

/// <summary>
/// Maps the <see cref="AvailabilityResponse"/> entity — one registered member's marked subset of a
/// match's candidate days. The relationship to the owning <see cref="Match"/> (the <c>MatchId</c>
/// foreign key) is configured from the match side; this configuration declares the response's own
/// columns, the <c>jsonb</c>-serialised marked-day subset, and the uniqueness that enforces the
/// one-response-per-member invariant.
/// <para>
/// A filtered-free unique index on <c>(match_id, squad_membership_id)</c> makes the
/// "at most one response per member per match" invariant unbreakable under concurrency
/// (Requirement 4.2). The shared <see cref="Domain.Common.BaseEntity"/> conventions and snake_case
/// naming are applied centrally by <see cref="PitchMateDbContext"/>.
/// </para>
/// </summary>
internal sealed class AvailabilityResponseConfiguration : IEntityTypeConfiguration<AvailabilityResponse>
{
    public void Configure(EntityTypeBuilder<AvailabilityResponse> builder)
    {
        builder.Property(response => response.MatchId)
            .IsRequired();

        builder.Property(response => response.SquadMembershipId)
            .IsRequired();

        builder.Property(response => response.SubmittedAt)
            .IsRequired();

        // The marked subset of candidate days as a jsonb array of instants; a stored empty subset is
        // distinct from no stored response (Requirement 4.7, 16.3). Read/written through the backing field.
        builder.Property(response => response.MarkedDays)
            .HasConversion(
                MatchValueObjectJson.CandidateDaysConverter(),
                MatchValueObjectJson.CandidateDaysComparer())
            .HasColumnType("jsonb")
            .HasColumnName("marked_days");
        builder.Metadata
            .FindProperty(nameof(AvailabilityResponse.MarkedDays))!
            .SetPropertyAccessMode(PropertyAccessMode.Field);

        // At most one response per member per match (Requirement 4.2).
        builder.HasIndex(response => new { response.MatchId, response.SquadMembershipId })
            .IsUnique();
    }
}
