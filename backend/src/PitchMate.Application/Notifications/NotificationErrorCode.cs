namespace PitchMate.Application.Notifications;

/// <summary>
/// Stable, closed enumeration of every failure a notification use case can report.
/// The accompanying <see cref="NotificationError.Message"/> is for diagnostics only and is never parsed by callers.
/// </summary>
public enum NotificationErrorCode
{
    /// <summary>A publish supplied a value outside the eight defined notification types.</summary>
    UnknownNotificationType,

    /// <summary>An input violated a validation rule (e.g. title or body length out of range).</summary>
    ValidationFailed,

    /// <summary>An attempt was made to move a record's read state from <c>Read</c> back to <c>Unread</c>.</summary>
    InvalidReadStateTransition,

    /// <summary>A read or modify targeted a record not backed by the caller, or a squad the caller cannot access (non-disclosing).</summary>
    NotFound,

    /// <summary>The request required an authenticated caller and none was present.</summary>
    Unauthenticated,

    /// <summary>Recipient resolution or the atomic in-app commit failed.</summary>
    PublishFailed,

    /// <summary>A lifecycle removal could not complete.</summary>
    RemovalFailed
}
