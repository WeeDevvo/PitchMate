using PitchMate.Domain.Common;

namespace PitchMate.Domain.Notifications;

/// <summary>
/// The persisted, per-recipient record of a delivered notification on the <see cref="DeliveryChannel.InApp"/>
/// channel — the guaranteed source of truth for a delivered notification. It references its owning
/// squad, its recipient (a registered <c>SquadMembership</c>), and its <see cref="NotificationType"/>,
/// and carries the rendered English <see cref="Title"/> and <see cref="Body"/> plus a
/// <see cref="ReadState"/> (Requirements 3.1, 3.7).
/// <para>
/// Deriving from <see cref="BaseEntity"/> supplies the GUID v7 key and audit fields; the creation
/// instant is <see cref="BaseEntity.CreatedAt"/>, stamped by the persistence layer's audit pipeline
/// from the injected clock, so the entity itself holds no clock concern (Requirements 3.1, 12.1, 12.3).
/// </para>
/// <para>
/// Unlike history-bearing entities, an <see cref="InAppNotification"/> carries no match-history
/// integrity requirement, so it deliberately does <b>not</b> implement <c>IAnonymisable</c>: on
/// erasure the record is removed rather than anonymised (Requirement 11.1, 11.2).
/// </para>
/// </summary>
public sealed class InAppNotification : BaseEntity
{
    /// <summary>The maximum length, in characters, of a rendered notification title.</summary>
    public const int TitleMaxLength = 200;

    /// <summary>The minimum length, in characters, of a rendered notification title.</summary>
    public const int TitleMinLength = 1;

    /// <summary>The maximum length, in characters, of a rendered notification body.</summary>
    public const int BodyMaxLength = 2000;

    /// <summary>The minimum length, in characters, of a rendered notification body.</summary>
    public const int BodyMinLength = 1;

    /// <summary>Parameterless constructor reserved for the persistence layer.</summary>
    private InAppNotification()
    {
        Title = string.Empty;
        Body = string.Empty;
    }

    private InAppNotification(
        Guid squadId,
        Guid recipientMembershipId,
        NotificationType type,
        string title,
        string body)
    {
        SquadId = squadId;
        RecipientMembershipId = recipientMembershipId;
        Type = type;
        Title = title;
        Body = body;
        ReadState = ReadState.Unread;
    }

    /// <summary>The identity of the squad that owns this notification.</summary>
    public Guid SquadId { get; private set; }

    /// <summary>The identity of the recipient registered <c>SquadMembership</c> this record belongs to.</summary>
    public Guid RecipientMembershipId { get; private set; }

    /// <summary>The catalogued kind of notification this record represents.</summary>
    public NotificationType Type { get; private set; }

    /// <summary>The rendered English title; 1..200 characters.</summary>
    public string Title { get; private set; }

    /// <summary>The rendered English body; 1..2000 characters.</summary>
    public string Body { get; private set; }

    /// <summary>The read status of this record; <see cref="Notifications.ReadState.Unread"/> at creation.</summary>
    public ReadState ReadState { get; private set; }

    /// <summary>
    /// Creates an <see cref="Notifications.ReadState.Unread"/> in-app notification for one recipient.
    /// The trimmed-agnostic <paramref name="title"/> must be 1..200 characters and the
    /// <paramref name="body"/> 1..2000 characters; an out-of-range value is rejected with a
    /// <see cref="NotificationErrorCode.ValidationFailed"/> failure and produces no entity
    /// (Requirements 3.1, 3.2). The creation instant is stamped later by the persistence audit
    /// pipeline into <see cref="BaseEntity.CreatedAt"/>, so no clock is taken here (Requirement 12.3).
    /// </summary>
    /// <param name="squadId">The owning squad's identity.</param>
    /// <param name="recipientMembershipId">The recipient registered membership's identity.</param>
    /// <param name="type">The catalogued notification type.</param>
    /// <param name="title">The rendered English title; must be 1..200 characters.</param>
    /// <param name="body">The rendered English body; must be 1..2000 characters.</param>
    /// <returns>A success carrying the new record, or a validation failure.</returns>
    public static Result<InAppNotification> Create(
        Guid squadId,
        Guid recipientMembershipId,
        NotificationType type,
        string title,
        string body)
    {
        if (title is null || title.Length < TitleMinLength || title.Length > TitleMaxLength)
        {
            return Result<InAppNotification>.Fail(new NotificationError(
                NotificationErrorCode.ValidationFailed,
                $"Title must be {TitleMinLength} to {TitleMaxLength} characters."));
        }

        if (body is null || body.Length < BodyMinLength || body.Length > BodyMaxLength)
        {
            return Result<InAppNotification>.Fail(new NotificationError(
                NotificationErrorCode.ValidationFailed,
                $"Body must be {BodyMinLength} to {BodyMaxLength} characters."));
        }

        return Result<InAppNotification>.Ok(
            new InAppNotification(squadId, recipientMembershipId, type, title, body));
    }

    /// <summary>
    /// Marks this record read. An <see cref="Notifications.ReadState.Unread"/> record becomes
    /// <see cref="Notifications.ReadState.Read"/>; a record that is already
    /// <see cref="Notifications.ReadState.Read"/> is left unchanged and reported as success, so the
    /// operation is idempotent (Requirements 3.4, 3.5). There is no path that returns a record to
    /// <see cref="Notifications.ReadState.Unread"/>.
    /// </summary>
    /// <returns>A success once the record is read.</returns>
    public Result MarkRead() => TransitionTo(ReadState.Read);

    /// <summary>
    /// The single guarded read-state transition. The only state change this entity permits is towards
    /// <see cref="Notifications.ReadState.Read"/>: transitioning to <see cref="Notifications.ReadState.Read"/>
    /// always succeeds (forward from <see cref="Notifications.ReadState.Unread"/>, or an idempotent no-op
    /// when already <see cref="Notifications.ReadState.Read"/>). Any attempt to move a record that is
    /// already <see cref="Notifications.ReadState.Read"/> back to <see cref="Notifications.ReadState.Unread"/>
    /// is rejected with an <see cref="NotificationErrorCode.InvalidReadStateTransition"/> failure and
    /// leaves the record <see cref="Notifications.ReadState.Read"/> (Requirement 3.8).
    /// </summary>
    /// <param name="target">The desired read state.</param>
    /// <returns>A success when the transition is permitted, or an invalid-transition failure.</returns>
    public Result TransitionTo(ReadState target)
    {
        if (target == ReadState.Read)
        {
            ReadState = ReadState.Read;
            return Result.Ok();
        }

        // target is Unread: only a record that is still Unread may remain Unread; a Read record
        // can never be reverted (Requirement 3.8).
        if (ReadState == ReadState.Read)
        {
            return Result.Fail(new NotificationError(
                NotificationErrorCode.InvalidReadStateTransition,
                "Read-state transitions are permitted only from Unread to Read."));
        }

        return Result.Ok();
    }
}
