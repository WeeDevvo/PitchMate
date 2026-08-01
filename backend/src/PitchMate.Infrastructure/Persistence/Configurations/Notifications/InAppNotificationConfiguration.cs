using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using PitchMate.Domain.Notifications;

namespace PitchMate.Infrastructure.Persistence.Configurations.Notifications;

/// <summary>
/// Maps the <see cref="InAppNotification"/> entity — the persisted, per-recipient source of truth
/// for a delivered notification (Requirements 3.1, 3.2). The shared
/// <see cref="Domain.Common.BaseEntity"/> conventions (uuid key, <c>xmin</c> concurrency token, the
/// global soft-delete query filter, and audit timestamps) and snake_case table/column naming are
/// applied centrally by <see cref="PitchMateDbContext"/>, so this configuration declares only the
/// notification-specific columns, length constraints, enum-as-int mapping, and the two supporting
/// indexes. Discovering this configuration from the Infrastructure assembly is what registers the
/// entity on <see cref="PitchMateDbContext"/> (Requirement 12.6).
/// <list type="bullet">
/// <item><c>ix_in_app_notification_recipient_created</c> on
/// <c>(recipient_membership_id, created_at DESC, id DESC)</c> serves a single recipient's list in a
/// stable, most-recent-first total order without scanning other recipients' rows
/// (Requirements 9.1, 12.7).</item>
/// <item><c>ix_in_app_notification_recipient_unread</c> on <c>(recipient_membership_id)</c> filtered
/// <c>WHERE read_state = 0</c> (<see cref="ReadState.Unread"/>) serves the unread count without
/// scanning read rows (Requirements 9.3, 12.8).</item>
/// </list>
/// </summary>
internal sealed class InAppNotificationConfiguration : IEntityTypeConfiguration<InAppNotification>
{
    public void Configure(EntityTypeBuilder<InAppNotification> builder)
    {
        // Owning squad; not null (Requirements 3.1, 10.4).
        builder.Property(notification => notification.SquadId)
            .IsRequired();

        // Recipient registered membership; not null (Requirements 3.1, 4.1).
        builder.Property(notification => notification.RecipientMembershipId)
            .IsRequired();

        // Persisted as the explicit, stable enum numeric value (int); not null (Requirement 2.1).
        builder.Property(notification => notification.Type)
            .IsRequired();

        // Rendered English title; 1..200 characters, not null (Requirement 3.1).
        builder.Property(notification => notification.Title)
            .IsRequired()
            .HasMaxLength(InAppNotification.TitleMaxLength);

        // Rendered English body; 1..2000 characters, not null (Requirement 3.1).
        builder.Property(notification => notification.Body)
            .IsRequired()
            .HasMaxLength(InAppNotification.BodyMaxLength);

        // Read state as its int value; not null; a newly created record defaults to Unread (0)
        // (Requirement 3.2).
        builder.Property(notification => notification.ReadState)
            .IsRequired()
            .HasDefaultValue(ReadState.Unread);

        // Serves a single recipient's list in stable, most-recent-first total order — creation
        // instant descending, GUID v7 identity descending as the tie-break — without scanning other
        // recipients' rows (Requirements 9.1, 12.7).
        builder.HasIndex(notification => new
            {
                notification.RecipientMembershipId,
                notification.CreatedAt,
                notification.Id
            })
            .IsDescending(false, true, true)
            .HasDatabaseName("ix_in_app_notification_recipient_created");

        // Serves the unread count for a single recipient without scanning read rows; ReadState.Unread
        // is the numeric value 0 (Requirements 9.3, 12.8).
        builder.HasIndex(notification => notification.RecipientMembershipId)
            .HasFilter($"read_state = {(int)ReadState.Unread}")
            .HasDatabaseName("ix_in_app_notification_recipient_unread");
    }
}
