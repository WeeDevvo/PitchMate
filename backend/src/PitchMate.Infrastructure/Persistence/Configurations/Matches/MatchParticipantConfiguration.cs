using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PitchMate.Domain.Matches;
using PitchMate.Domain.Squads;

namespace PitchMate.Infrastructure.Persistence.Configurations.Matches;

/// <summary>
/// Maps the <see cref="MatchParticipant"/> entity — one squad membership in a match's playing pool,
/// carrying its display-name-at-time and stable roster position. The relationship to the owning
/// <see cref="Match"/> (the <c>MatchId</c> foreign key) is configured from the match side; this
/// configuration declares the participant's own columns and the uniqueness that enforces the
/// no-duplicate-participant invariant.
/// <para>
/// A unique index on <c>(match_id, squad_membership_id)</c> makes the "a membership appears at most
/// once per match" invariant unbreakable under concurrency (Requirement 7.4). Team assignment is
/// modelled on the working <see cref="MatchTeam"/> roster rather than a foreign key on the
/// participant, matching the Domain shape. The shared <see cref="Domain.Common.BaseEntity"/>
/// conventions and snake_case naming are applied centrally by <see cref="PitchMateDbContext"/>.
/// </para>
/// </summary>
internal sealed class MatchParticipantConfiguration : IEntityTypeConfiguration<MatchParticipant>
{
    public void Configure(EntityTypeBuilder<MatchParticipant> builder)
    {
        builder.Property(participant => participant.MatchId)
            .IsRequired();

        builder.Property(participant => participant.SquadMembershipId)
            .IsRequired();

        // Display name captured at the time of addition, so a later rename does not rewrite history.
        builder.Property(participant => participant.DisplayName)
            .IsRequired()
            .HasMaxLength(SquadMembership.DisplayNameMaxLength);

        builder.Property(participant => participant.IsGuest)
            .IsRequired();

        builder.Property(participant => participant.RosterPosition)
            .IsRequired();

        // A membership appears at most once per match (Requirement 7.4).
        builder.HasIndex(participant => new { participant.MatchId, participant.SquadMembershipId })
            .IsUnique();
    }
}
