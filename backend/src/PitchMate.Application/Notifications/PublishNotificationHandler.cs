using Microsoft.Extensions.Logging;
using PitchMate.Application.Auth.Abstractions;
using PitchMate.Application.Common.Persistence;
using PitchMate.Domain.Notifications;
using PitchMate.Domain.Squads;
using AuthResult = PitchMate.Application.Auth.Result;
using Result = PitchMate.Domain.Notifications.Result;

namespace PitchMate.Application.Notifications;

/// <summary>
/// The single publish fan-out use case that producers reach through <see cref="INotificationPublisher"/>.
/// The full flow is <b>validate type → resolve recipients → persist in-app records atomically → attempt
/// best-effort email</b>; this type is built incrementally across tasks 4.1, 4.3, and 4.5.
/// <para>
/// Tasks 4.1 and 4.3 implement the whole in-app path:
/// </para>
/// <list type="number">
/// <item>Validate <paramref name="type"/> against the <see cref="NotificationCatalogue"/> before any
/// recipient resolution or write; an unrecognised value is rejected with
/// <see cref="NotificationErrorCode.UnknownNotificationType"/> and produces no side effects
/// (Requirement 2.5).</item>
/// <item>Resolve recipients via the type's <see cref="TargetingRule"/> — a broadcast to the squad's active
/// registered memberships, or a directed set of the caller-supplied affected memberships — then filter to
/// registered (user-backed) memberships of the owning squad and de-duplicate by membership id
/// (Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.7, 4.8).</item>
/// <item>Treat an empty resolved set as a no-op success that writes nothing and emails nothing
/// (Requirement 4.6).</item>
/// <item>Otherwise render each recipient's in-app content from the catalogue, create one
/// <see cref="ReadState.Unread"/> <see cref="InAppNotification"/> per recipient, and commit them
/// atomically in one <see cref="IUnitOfWork.SaveChangesAsync"/>. A failure, or a
/// <see cref="CancellationToken"/> signalled before the commit, yields
/// <see cref="NotificationErrorCode.PublishFailed"/> with no partial set — the all-or-nothing guarantee is
/// the unit of work's (Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.7, 5.8).</item>
/// </list>
/// <para>
/// Task 4.5 layers the best-effort, isolated email dispatch onto the committed in-app path. After the
/// in-app records commit, the handler resolves each recipient's deliverable email in one batch query,
/// skips any recipient without a deliverable address (non-error), renders the message and submits it to
/// <see cref="IEmailSender"/> under a 30-second per-recipient timeout, and isolates every failure, thrown
/// exception, or timeout — logging only the <see cref="NotificationType"/>, owning squad id, recipient
/// membership id, and a failure reason (never the rendered subject, body, or email address), continuing to
/// the remaining recipients, and never altering the committed records or the success result
/// (Requirements 1.3, 6.1–6.7, 7.3, 7.5).
/// </para>
/// </summary>
public sealed class PublishNotificationHandler : INotificationPublisher
{
    /// <summary>The best-effort email attempt budget per recipient (Requirements 6.1, 6.7).</summary>
    private static readonly TimeSpan EmailTimeout = TimeSpan.FromSeconds(30);

    private readonly INotificationRepository _notifications;
    private readonly IUnitOfWork _unitOfWork;
    private readonly INotificationEmailRenderer _emailRenderer;
    private readonly IEmailSender _emailSender;
    private readonly ILogger<PublishNotificationHandler> _logger;

    /// <summary>Creates the handler with the collaborators it resolves, persists, renders, and dispatches with.</summary>
    /// <param name="notifications">The notification persistence surface used for recipient targeting, staging in-app records, and resolving recipient emails.</param>
    /// <param name="unitOfWork">The unit of work that commits the fan-out's in-app records atomically.</param>
    /// <param name="emailRenderer">Renders each recipient's notification into an email message.</param>
    /// <param name="emailSender">The existing single email transport reused for best-effort delivery.</param>
    /// <param name="logger">Records isolated email failures with identifiers only, never content or addresses.</param>
    public PublishNotificationHandler(
        INotificationRepository notifications,
        IUnitOfWork unitOfWork,
        INotificationEmailRenderer emailRenderer,
        IEmailSender emailSender,
        ILogger<PublishNotificationHandler> logger)
    {
        ArgumentNullException.ThrowIfNull(notifications);
        ArgumentNullException.ThrowIfNull(unitOfWork);
        ArgumentNullException.ThrowIfNull(emailRenderer);
        ArgumentNullException.ThrowIfNull(emailSender);
        ArgumentNullException.ThrowIfNull(logger);

        _notifications = notifications;
        _unitOfWork = unitOfWork;
        _emailRenderer = emailRenderer;
        _emailSender = emailSender;
        _logger = logger;
    }

    /// <inheritdoc />
    public async Task<Result> PublishAsync(
        NotificationType type,
        Guid squadId,
        IReadOnlyCollection<Guid> directedTargetMembershipIds,
        NotificationContext context,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(directedTargetMembershipIds);
        ArgumentNullException.ThrowIfNull(context);

        // 1. Reject an unrecognised type up front, before resolving any recipient or writing anything
        //    (Requirement 2.5).
        if (!NotificationCatalogue.IsRecognised(type))
        {
            return Result.Fail(new Domain.Notifications.NotificationError(
                Domain.Notifications.NotificationErrorCode.UnknownNotificationType,
                $"The notification type '{type}' is not a member of the catalogue."));
        }

        // 2. Resolve the recipients for this type's targeting rule, restricted to registered memberships
        //    of the owning squad and de-duplicated by membership id (Requirements 4.1, 4.5, 4.7, 4.8).
        IReadOnlyList<SquadMembership> recipients =
            await ResolveRecipientsAsync(type, squadId, directedTargetMembershipIds, cancellationToken);

        // 3. An empty recipient set is a success that writes no in-app record and attempts no email
        //    (Requirement 4.6).
        if (recipients.Count == 0)
        {
            return Result.Ok();
        }

        // 4. Create one Unread InAppNotification per resolved recipient and commit them atomically in a
        //    single unit of work. Any failure, or a cancellation signalled before the commit, leaves no
        //    partial set and is reported as PublishFailed; the all-or-nothing guarantee is the unit of
        //    work's responsibility (Requirements 5.1, 5.2, 5.3, 5.4, 5.7, 5.8).
        try
        {
            foreach (SquadMembership recipient in recipients)
            {
                NotificationContent content = NotificationCatalogue.RenderInAppContent(type, context);

                Domain.Notifications.Result<InAppNotification> created = InAppNotification.Create(
                    squadId, recipient.Id, type, content.Title, content.Body);

                if (!created.IsSuccess)
                {
                    // Rendered content should always be within bounds; a validation failure here means the
                    // notification cannot be built, so fail the publish before committing any partial set.
                    return Result.Fail(new Domain.Notifications.NotificationError(
                        Domain.Notifications.NotificationErrorCode.PublishFailed,
                        $"Failed to build the in-app notification for type '{type}'."));
                }

                await _notifications.AddAsync(created.Value!, cancellationToken);
            }

            // Commit every recipient's record atomically — either all persist or none do (Requirement 5.7).
            await _unitOfWork.SaveChangesAsync(cancellationToken);
        }
        catch (Exception ex) when (ex is not OutOfMemoryException and not StackOverflowException)
        {
            // A save failure or a signalled cancellation token before commit surfaces as a publish failure
            // with no partial set persisted (Requirements 5.4, 5.8). The unit of work rolls back its
            // transaction, so no in-app record for this notification survives.
            return Result.Fail(new Domain.Notifications.NotificationError(
                Domain.Notifications.NotificationErrorCode.PublishFailed,
                $"Failed to persist the in-app notifications for type '{type}'."));
        }

        // 5. The in-app records are now committed and are the source of truth. Attempt email for each
        //    recipient on a best-effort, fully isolated basis: any resolution failure, per-recipient send
        //    failure, thrown exception, or timeout is caught and logged with identifiers only, never alters
        //    the committed records, never halts the remaining recipients, and never changes this success
        //    result (Requirements 1.3, 5.3, 6.1–6.7, 7.3, 7.5).
        await DispatchEmailsBestEffortAsync(type, squadId, recipients, context, cancellationToken);

        return Result.Ok();
    }

    /// <summary>
    /// Attempts the email channel for every recipient on a best-effort basis after the in-app records have
    /// committed. Emails are resolved in one batch query (avoiding an N+1 lookup); a recipient with no
    /// deliverable address is skipped as a non-error (Requirement 6.6). Each send runs under a 30-second
    /// per-recipient timeout via a linked cancellation source, and every failure Result, thrown exception,
    /// or timeout is caught and routed through <see cref="LogEmailFailure"/> — the fan-out continues to the
    /// remaining recipients and the publish result is unaffected (Requirements 6.1, 6.2, 6.3, 6.4, 6.5,
    /// 6.7, 7.3, 7.5). The whole routine is wrapped so that even a failure resolving the email batch cannot
    /// disturb the committed in-app records or the success result.
    /// </summary>
    private async Task DispatchEmailsBestEffortAsync(
        NotificationType type,
        Guid squadId,
        IReadOnlyList<SquadMembership> recipients,
        NotificationContext context,
        CancellationToken cancellationToken)
    {
        IReadOnlyDictionary<Guid, string> emailsByMembership;
        try
        {
            emailsByMembership = await _notifications.ResolveRecipientEmailsAsync(
                squadId, recipients.Select(r => r.Id).ToList(), cancellationToken);
        }
        catch (Exception ex) when (ex is not OutOfMemoryException and not StackOverflowException)
        {
            // Resolving the email batch failed; email is best-effort, so isolate it entirely — the
            // committed in-app records and the publish success are untouched. Log without any content.
            _logger.LogWarning(
                "Notification email dispatch skipped: failed to resolve recipient emails. "
                + "Type={NotificationType}, SquadId={SquadId}, Reason={Reason}",
                type, squadId, ex.GetType().Name);
            return;
        }

        foreach (SquadMembership recipient in recipients)
        {
            // A recipient with no deliverable email address (absent or empty) is skipped, not failed; its
            // in-app record remains committed (Requirement 6.6).
            if (!emailsByMembership.TryGetValue(recipient.Id, out string? recipientEmail)
                || string.IsNullOrEmpty(recipientEmail))
            {
                continue;
            }

            await AttemptEmailAsync(type, squadId, recipient.Id, recipientEmail, context, cancellationToken);
        }
    }

    /// <summary>
    /// Renders and submits a single recipient's email under a 30-second timeout, isolating every outcome so
    /// it can never fail the publish or halt the fan-out. A failure <see cref="AuthResult"/>, any thrown
    /// exception, and a timeout are all caught and logged with identifiers only (Requirements 6.1, 6.2,
    /// 6.4, 6.7, 7.3, 7.5).
    /// </summary>
    private async Task AttemptEmailAsync(
        NotificationType type,
        Guid squadId,
        Guid recipientMembershipId,
        string recipientEmail,
        NotificationContext context,
        CancellationToken cancellationToken)
    {
        // Link the caller's token to a per-recipient 30-second budget so a slow transport is abandoned and
        // routed through the same isolation guarantees (Requirements 6.1, 6.7).
        using var timeoutSource = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutSource.CancelAfter(EmailTimeout);

        try
        {
            EmailMessage message = _emailRenderer.Render(type, recipientEmail, context);
            AuthResult delivery = await _emailSender.SendAsync(message, timeoutSource.Token);

            if (!delivery.IsSuccess)
            {
                // The transport rejected the message (for example a present-but-malformed address rejected
                // by EmailSenderBase, per Requirement 7.5). Log the stable error code only — never the
                // address, subject, or body.
                LogEmailFailure(type, squadId, recipientMembershipId, delivery.Error?.Code.ToString() ?? "Unknown");
            }
        }
        catch (OperationCanceledException) when (timeoutSource.IsCancellationRequested)
        {
            // The attempt exceeded its 30-second budget (or the caller cancelled); abandon it and isolate
            // the outcome exactly like any other email failure (Requirement 6.7).
            LogEmailFailure(type, squadId, recipientMembershipId, "Timeout");
        }
        catch (Exception ex) when (ex is not OutOfMemoryException and not StackOverflowException)
        {
            // Any thrown transport/rendering failure is isolated; the fan-out continues (Requirements 6.2,
            // 6.3). Log the exception type only so no notification content or address can leak.
            LogEmailFailure(type, squadId, recipientMembershipId, ex.GetType().Name);
        }
    }

    /// <summary>
    /// Records an isolated email failure carrying only the <paramref name="type"/>, owning
    /// <paramref name="squadId"/>, <paramref name="recipientMembershipId"/>, and a non-sensitive
    /// <paramref name="reason"/> — never the rendered subject, rendered body, or the recipient's email
    /// address (Requirement 6.4).
    /// </summary>
    private void LogEmailFailure(
        NotificationType type, Guid squadId, Guid recipientMembershipId, string reason) =>
        _logger.LogWarning(
            "Notification email delivery failed (isolated, in-app record retained). "
            + "Type={NotificationType}, SquadId={SquadId}, RecipientMembershipId={RecipientMembershipId}, Reason={Reason}",
            type, squadId, recipientMembershipId, reason);

    /// <summary>
    /// Resolves the recipients for <paramref name="type"/> using its <see cref="TargetingRule"/>: a
    /// <see cref="TargetingRule.Broadcast"/> resolves to the owning squad's active registered memberships,
    /// and a <see cref="TargetingRule.Directed"/> resolves to the caller-supplied affected memberships
    /// intersected with the squad's registered memberships. The resolved set is then defensively filtered
    /// to registered (user-backed) memberships of the owning squad and de-duplicated by membership id, so
    /// no guest membership, no membership of another squad, and no duplicate ever becomes a recipient
    /// (Requirements 4.1, 4.5, 4.7, 4.8).
    /// </summary>
    private async Task<IReadOnlyList<SquadMembership>> ResolveRecipientsAsync(
        NotificationType type,
        Guid squadId,
        IReadOnlyCollection<Guid> directedTargetMembershipIds,
        CancellationToken cancellationToken)
    {
        TargetingRule rule = NotificationCatalogue.GetTargetingRule(type);

        IReadOnlyList<SquadMembership> resolved = rule switch
        {
            TargetingRule.Broadcast =>
                await _notifications.ListActiveRegisteredAsync(squadId, cancellationToken),
            TargetingRule.Directed =>
                await _notifications.ResolveRegisteredAsync(squadId, directedTargetMembershipIds, cancellationToken),
            _ => [],
        };

        return resolved
            .Where(membership => membership is not null && !membership.IsGuest && membership.SquadId == squadId)
            .DistinctBy(membership => membership.Id)
            .ToList();
    }
}
