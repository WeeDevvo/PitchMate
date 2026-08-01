using PitchMate.Domain.Notifications;

namespace PitchMate.Application.Notifications;

/// <summary>
/// A single row of the notification read model: the caller's own <see cref="InAppNotification"/>
/// projected to the fields the app shell renders (Requirement 9.2). Carries the record's identity so
/// the client can target it for a mark-read request, its owning squad, its catalogued
/// <see cref="NotificationType"/>, its rendered English title and body, its creation instant, and its
/// <see cref="ReadState"/>. It carries no recipient or contact PII beyond the already-rendered content.
/// </summary>
/// <param name="NotificationId">The notification record's own identity (the caller's own record).</param>
/// <param name="Type">The catalogued notification type.</param>
/// <param name="SquadId">The owning squad's identity.</param>
/// <param name="Title">The rendered English title.</param>
/// <param name="Body">The rendered English body.</param>
/// <param name="CreatedAt">The creation instant, from <see cref="Domain.Common.BaseEntity.CreatedAt"/>.</param>
/// <param name="ReadState">The record's read state.</param>
public sealed record NotificationSummary(
    Guid NotificationId,
    NotificationType Type,
    Guid SquadId,
    string Title,
    string Body,
    DateTimeOffset CreatedAt,
    ReadState ReadState);
