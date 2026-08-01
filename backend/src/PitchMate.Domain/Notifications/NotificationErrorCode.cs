namespace PitchMate.Domain.Notifications;

/// <summary>
/// Stable, switchable enumeration of every failure a notification operation can report, owned by the
/// Domain and reused by the Application layer in the same way <see cref="PitchMate.Domain.Squads.SquadErrorCode"/>
/// is. The accompanying <see cref="NotificationError.Message"/> is for diagnostics only and is never
/// parsed by callers.
/// </summary>
public enum NotificationErrorCode
{
    /// <summary>A publish request supplied a value that is not one of the eight defined notification types.</summary>
    UnknownNotificationType,

    /// <summary>An input violated a validation rule (e.g. a title or body outside its permitted length).</summary>
    ValidationFailed,

    /// <summary>An attempt was made to move a read-state from <see cref="ReadState.Read"/> back to <see cref="ReadState.Unread"/>.</summary>
    InvalidReadStateTransition,

    /// <summary>A read or modify request targeted a record not backed by the caller, or a squad the caller cannot access; non-disclosing.</summary>
    NotFound,

    /// <summary>There is no authenticated caller for a request that requires one.</summary>
    Unauthenticated,

    /// <summary>Recipient resolution or the atomic in-app commit failed, so the publish is unsuccessful.</summary>
    PublishFailed,

    /// <summary>A lifecycle removal could not complete.</summary>
    RemovalFailed
}
