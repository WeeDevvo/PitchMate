using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;
using PitchMate.Domain.LiveTracking;
using PitchMate.Domain.Squads;

namespace PitchMate.Infrastructure.Persistence.Configurations.LiveTracking;

/// <summary>
/// Maps the <see cref="MatchEvent"/> append-only log using table-per-hierarchy: the abstract base and
/// its four concrete subclasses (<see cref="GoalScoredEvent"/>, <see cref="GoalRetractedEvent"/>,
/// <see cref="KeeperStintStartedEvent"/>, <see cref="KeeperStintRetractedEvent"/>) share one table,
/// discriminated by the <see cref="MatchEvent.Kind"/> <c>EventKind</c> column (Requirement 1.6). The
/// shared <see cref="Domain.Common.BaseEntity"/> conventions — the <c>uuid</c> primary key with
/// application-supplied identity (here the client-generated GUID v7 <c>Event_Id</c>), the <c>xmin</c>
/// concurrency token, the global soft-delete filter, and audit stamping — plus snake_case naming are
/// applied centrally on the hierarchy root by <see cref="PitchMateDbContext"/>, so this configuration
/// declares only the event-specific mapping.
/// <list type="bullet">
/// <item>An index on <see cref="MatchEvent.MatchId"/> supports loading a match's log for derivation
/// and duplicate classification (Requirement 7.5).</item>
/// <item>A foreign key on <see cref="MatchEvent.SquadId"/> anchors every event to its owning squad —
/// the visibility scope boundary (Requirement 11.3) — with no cascade, since the append-only log is
/// retained for replay just like matches and ratings.</item>
/// <item><see cref="MatchEvent.Minute"/> is the <see cref="MatchMinute"/> value object, persisted as
/// its underlying whole-minute <see cref="int"/> through a value converter.</item>
/// <item>The per-subclass columns (<c>ScoringTeamId</c>, <c>ScorerMembershipId</c>, <c>OwnGoal</c>,
/// <c>KeeperMembershipId</c>, <c>KeptTeamId</c>, <c>TargetEventId</c>) are nullable at the table level
/// — a table-per-hierarchy necessity — while being non-null per kind by construction in the Domain.
/// The two retraction kinds share a single <c>target_event_id</c> column.</item>
/// </list>
/// </summary>
internal sealed class MatchEventConfiguration : IEntityTypeConfiguration<MatchEvent>
{
    public void Configure(EntityTypeBuilder<MatchEvent> builder)
    {
        // Table-per-hierarchy: the stable EventKind numeric value discriminates the four subclasses
        // in one shared table (Requirement 1.6).
        builder.HasDiscriminator(matchEvent => matchEvent.Kind)
            .HasValue<GoalScoredEvent>(EventKind.GoalScored)
            .HasValue<GoalRetractedEvent>(EventKind.GoalRetracted)
            .HasValue<KeeperStintStartedEvent>(EventKind.KeeperStintStarted)
            .HasValue<KeeperStintRetractedEvent>(EventKind.KeeperStintRetracted);

        // The match the event belongs to; not null and indexed for log loading and duplicate
        // classification. No foreign-key relationship is declared here so the deliberately loose
        // association never implicitly removes an event (Requirement 7.5).
        builder.Property(matchEvent => matchEvent.MatchId)
            .IsRequired();
        builder.HasIndex(matchEvent => matchEvent.MatchId);

        // The owning squad — the visibility scope boundary (Requirement 11.3); not null. The log is
        // retained for replay, so the relationship never implicitly removes an event row.
        builder.Property(matchEvent => matchEvent.SquadId)
            .IsRequired();
        builder.HasOne<Squad>()
            .WithMany()
            .HasForeignKey(matchEvent => matchEvent.SquadId)
            .OnDelete(DeleteBehavior.ClientNoAction);

        // The MatchMinute value object persisted as its underlying whole-minute int. Stored values are
        // always range-valid (validated on recording), so reconstruction goes through the factory.
        builder.Property(matchEvent => matchEvent.Minute)
            .HasConversion(new ValueConverter<MatchMinute, int>(
                minute => minute.Value,
                value => MatchMinute.Create(value).Value))
            .IsRequired();

        // The per-subclass columns (ScoringTeamId, ScorerMembershipId, OwnGoal, KeeperMembershipId,
        // KeptTeamId, TargetEventId) are mapped by convention on their concrete subclasses. Under
        // table-per-hierarchy they are nullable at the table level while remaining non-null per kind by
        // construction in the Domain. The two retraction kinds' identically-named, identically-typed
        // TargetEventId properties are unified onto a single nullable target_event_id column by EF's
        // table-per-hierarchy column-sharing convention.
    }
}
