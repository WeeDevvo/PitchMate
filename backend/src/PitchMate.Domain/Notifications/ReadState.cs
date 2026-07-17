namespace PitchMate.Domain.Notifications;

/// <summary>
/// The closed read status of an in-app notification. A newly created record is <see cref="Unread"/>;
/// it may transition to <see cref="Read"/> and never back (Requirements 3.1, 3.2, 3.8, 13.1).
/// </summary>
public enum ReadState
{
    /// <summary>The recipient has not yet read the notification. The initial state of every record.</summary>
    Unread,

    /// <summary>The recipient has marked the notification read. A terminal state.</summary>
    Read
}
