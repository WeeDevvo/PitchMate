namespace PitchMate.Domain.Notifications;

/// <summary>
/// The closed set of channels a notification can be delivered over for the web-first MVP: the
/// persisted in-app record and best-effort email. There is deliberately no push channel — push
/// arrives with the future mobile app and is not modelled here (Requirements 1.1, 13.1).
/// </summary>
public enum DeliveryChannel
{
    /// <summary>The persisted, per-recipient in-app notification — the guaranteed source of truth.</summary>
    InApp,

    /// <summary>The best-effort email channel, attempted after the in-app record is persisted.</summary>
    Email
}
