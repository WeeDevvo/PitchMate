using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PitchMate.Domain.Matches;
using PitchMate.Domain.Squads;

namespace PitchMate.Infrastructure.Persistence.Configurations.Matches;

/// <summary>
/// Maps the <see cref="RatingSnapshot"/> entity — one immutable per-participant rating (μ, σ)
/// captured immediately after a completed match's single rating update, one row per participant per
/// completed match (Requirement 12.1). The ordered sequence of a membership's snapshots reconstructs
/// its rating progression for the stats and rating-replay use cases.
/// <para>
/// A unique index on <c>(match_id, squad_membership_id)</c> enforces exactly one snapshot per
/// participant per match, so an idempotent re-completion can never write a duplicate
/// (Requirement 12.7, 13.5). A supporting index on <c>squad_membership_id</c> serves a membership's
/// progression history. Neither foreign key implicitly removes a snapshot (replay history must be
/// retained), so both emit NO ACTION. The shared <see cref="Domain.Common.BaseEntity"/> conventions
/// and snake_case naming are applied centrally by <see cref="PitchMateDbContext"/>.
/// </para>
/// </summary>
internal sealed class RatingSnapshotConfiguration : IEntityTypeConfiguration<RatingSnapshot>
{
    public void Configure(EntityTypeBuilder<RatingSnapshot> builder)
    {
        builder.Property(snapshot => snapshot.MatchId)
            .IsRequired();

        builder.Property(snapshot => snapshot.SquadMembershipId)
            .IsRequired();

        builder.Property(snapshot => snapshot.Mu)
            .IsRequired();

        builder.Property(snapshot => snapshot.Sigma)
            .IsRequired();

        // Exactly one snapshot per participant per completed match (Requirement 12.7, 13.5).
        builder.HasIndex(snapshot => new { snapshot.MatchId, snapshot.SquadMembershipId })
            .IsUnique();

        // Serves a membership's rating progression history.
        builder.HasIndex(snapshot => snapshot.SquadMembershipId);

        builder.HasOne<Match>()
            .WithMany()
            .HasForeignKey(snapshot => snapshot.MatchId)
            .OnDelete(DeleteBehavior.ClientNoAction);

        builder.HasOne<SquadMembership>()
            .WithMany()
            .HasForeignKey(snapshot => snapshot.SquadMembershipId)
            .OnDelete(DeleteBehavior.ClientNoAction);
    }
}
