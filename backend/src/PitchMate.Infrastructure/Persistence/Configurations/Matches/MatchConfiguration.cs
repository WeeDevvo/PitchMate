using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;
using PitchMate.Domain.Matches;
using PitchMate.Domain.Squads;

namespace PitchMate.Infrastructure.Persistence.Configurations.Matches;

/// <summary>
/// Maps the <see cref="Match"/> aggregate root and the value objects it owns inline. The shared
/// <see cref="Domain.Common.BaseEntity"/> conventions (uuid key, <c>xmin</c> concurrency token, the
/// global soft-delete query filter, and audit stamping) and snake_case naming are applied centrally
/// by <see cref="PitchMateDbContext"/>, so this configuration declares only the match-specific
/// columns, the <c>jsonb</c>-serialised value objects, and the relationships to the aggregate's
/// child entities.
/// <list type="bullet">
/// <item><see cref="Match.CandidateDays"/> is stored as a <c>jsonb</c> array of instants — an owned
/// value collection whose per-match distinctness is guaranteed by the aggregate at draft creation
/// (Requirement 1.5), reconstructed through the value converter (Requirement 16.3).</item>
/// <item><see cref="Match.KickoffLineup"/> and <see cref="Match.RecordedResult"/> are stored as
/// <c>jsonb</c> documents — the immutable rating unit and the recorded scores (Requirement 10.1,
/// 11.3).</item>
/// <item><see cref="Match.ConfirmedDay"/> is a nullable <see cref="CandidateDay"/> persisted as its
/// UTC instant (Requirement 6.1).</item>
/// </list>
/// The child collections (<see cref="Match.Participants"/>, <see cref="Match.Teams"/>,
/// <see cref="Match.AvailabilityResponses"/>) are separate <see cref="Domain.Common.BaseEntity"/>
/// tables related by a <c>MatchId</c> foreign key and read/written through their backing fields.
/// </summary>
internal sealed class MatchConfiguration : IEntityTypeConfiguration<Match>
{
    public void Configure(EntityTypeBuilder<Match> builder)
    {
        // Owning squad; not null (Requirement 1.1). No inverse navigation, and a match carries
        // rating-replay history, so the relationship never implicitly removes a match row — the
        // squad purge use case owns match deletion explicitly (mirrors the membership policy).
        builder.Property(match => match.SquadId)
            .IsRequired();
        builder.HasOne<Squad>()
            .WithMany()
            .HasForeignKey(match => match.SquadId)
            .OnDelete(DeleteBehavior.ClientNoAction);
        builder.HasIndex(match => match.SquadId);

        // Lifecycle state persisted as its stable enum numeric value (int); not null (Requirement 2.1).
        builder.Property(match => match.State)
            .IsRequired();

        // Trimmed free-text location; 1..200 characters, not null (Requirement 1.3).
        builder.Property(match => match.Location)
            .IsRequired()
            .HasMaxLength(Match.LocationMaxLength);

        // The confirmed candidate day, or null while gathering availability (Requirement 6.1). Stored
        // as its UTC instant; the global timestamptz convention supplies the column type.
        builder.Property(match => match.ConfirmedDay)
            .HasConversion(new ValueConverter<CandidateDay, DateTimeOffset>(
                day => day.Instant,
                instant => new CandidateDay(instant)));

        // The replay ordering key, or null before completion (Requirement 12.1, 12.4).
        builder.Property(match => match.CompletedAt);

        // Candidate days as a jsonb array of instants; distinctness is enforced by the aggregate
        // (Requirement 1.5, 16.3). Read/written through the backing field.
        builder.Property(match => match.CandidateDays)
            .HasConversion(
                MatchValueObjectJson.CandidateDaysConverter(),
                MatchValueObjectJson.CandidateDaysComparer())
            .HasColumnType("jsonb")
            .HasColumnName("candidate_days");
        builder.Metadata
            .FindProperty(nameof(Match.CandidateDays))!
            .SetPropertyAccessMode(PropertyAccessMode.Field);

        // The immutable kickoff lineup captured at lock — the sole rating unit — as a jsonb document,
        // null before the first lock (Requirement 10.1, 16.3). The non-generic HasConversion overload
        // is used because the property is a nullable reference type while the converter's model type
        // is the non-nullable value object.
        builder.Property(match => match.KickoffLineup)
            .HasConversion(
                (ValueConverter)MatchValueObjectJson.KickoffLineupConverter(),
                (ValueComparer)MatchValueObjectJson.KickoffLineupComparer())
            .HasColumnType("jsonb")
            .HasColumnName("kickoff_lineup");

        // The recorded result — fidelity and per-team scores — as a jsonb document, null before a
        // result is recorded (Requirement 11.3, 16.3).
        builder.Property(match => match.RecordedResult)
            .HasConversion(
                (ValueConverter)MatchValueObjectJson.MatchResultConverter(),
                (ValueComparer)MatchValueObjectJson.MatchResultComparer())
            .HasColumnType("jsonb")
            .HasColumnName("recorded_result");

        // A match pools its participants; the participant carries the MatchId (no inverse navigation),
        // and participants are removed with the match they belong to.
        builder.HasMany(match => match.Participants)
            .WithOne()
            .HasForeignKey(participant => participant.MatchId)
            .OnDelete(DeleteBehavior.Cascade);
        builder.Metadata
            .FindNavigation(nameof(Match.Participants))!
            .SetPropertyAccessMode(PropertyAccessMode.Field);

        // A match holds its working teams while rolling; removed with the match.
        builder.HasMany(match => match.Teams)
            .WithOne()
            .HasForeignKey(team => team.MatchId)
            .OnDelete(DeleteBehavior.Cascade);
        builder.Metadata
            .FindNavigation(nameof(Match.Teams))!
            .SetPropertyAccessMode(PropertyAccessMode.Field);

        // A match collects availability responses while gathering availability; removed with the match.
        builder.HasMany(match => match.AvailabilityResponses)
            .WithOne()
            .HasForeignKey(response => response.MatchId)
            .OnDelete(DeleteBehavior.Cascade);
        builder.Metadata
            .FindNavigation(nameof(Match.AvailabilityResponses))!
            .SetPropertyAccessMode(PropertyAccessMode.Field);
    }
}
