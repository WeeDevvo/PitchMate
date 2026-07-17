namespace PitchMate.Application.Notifications;

/// <summary>
/// The immutable, squad-scoped data a notification needs to render its in-app and email content. It
/// carries only display-oriented values already visible within the squad — never any contact PII such
/// as an email address or phone number (Requirements 7.1, 11.5). The context is passed to the renderer
/// and is never persisted, so the only personal data that reaches the store is the rendered title and
/// body produced from these fields.
/// <para>
/// <see cref="SquadName"/> is always present. <see cref="ActorDisplayName"/> and
/// <see cref="AffectedMemberDisplayName"/> populate the squad-membership events (for example the joining
/// member, the promoted member, the removed member, or the new/former owner). The match-summary fields
/// are populated only for the match-lifecycle types, whose producers arrive in a later spec.
/// </para>
/// </summary>
public sealed record NotificationContext
{
    /// <summary>The owning squad's display name. Always present.</summary>
    public required string SquadName { get; init; }

    /// <summary>
    /// The display name of the member who caused the event (for example the member who joined, or the
    /// admin who performed a promotion or transfer), when the type has one. Never contact PII.
    /// </summary>
    public string? ActorDisplayName { get; init; }

    /// <summary>
    /// The display name of the member the event is about (for example the promoted member, the removed
    /// member, or the new owner), when the type has one. Never contact PII.
    /// </summary>
    public string? AffectedMemberDisplayName { get; init; }

    /// <summary>The match's location, for the match-lifecycle types. Null for squad-membership events.</summary>
    public string? MatchLocation { get; init; }

    /// <summary>The match's scheduled kickoff instant, for the match-lifecycle types. Null otherwise.</summary>
    public DateTimeOffset? MatchScheduledFor { get; init; }

    /// <summary>
    /// A short summary line for the match-lifecycle types (for example a final-result line such as
    /// "Team A won 12–8"). Null for squad-membership events.
    /// </summary>
    public string? MatchSummary { get; init; }
}
