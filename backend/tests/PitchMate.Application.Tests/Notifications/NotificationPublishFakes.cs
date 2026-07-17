using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Time.Testing;
using PitchMate.Application.Auth.Abstractions;
using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Notifications;
using PitchMate.Domain.Notifications;
using PitchMate.Domain.Rating;
using PitchMate.Domain.Squads;
using AuthResult = PitchMate.Application.Auth.Result;

namespace PitchMate.Application.Tests.Notifications;

/// <summary>
/// A hand-written, in-memory backing store shared by the notification publish test doubles. It holds a
/// mixed population of <see cref="SquadMembership"/> records (registered/guest, active/inactive, across
/// several squads) that the <see cref="FakeNotificationRepository"/> resolves recipients from, and it
/// records the <see cref="InAppNotification"/> records the publish handler would add. This is a real
/// fake (list-backed implementations of the Application contracts), not a mocking-framework stub and
/// not a database.
/// <para>
/// The resolution helpers mirror the documented <see cref="INotificationRepository"/> contract (and the
/// future EF implementation): <see cref="ListActiveRegistered"/> returns the owning squad's active
/// registered memberships, and <see cref="ResolveRegistered"/> returns those supplied ids that are
/// registered memberships of the owning squad — each membership at most once, exactly as a SQL
/// <c>WHERE id = ANY(...)</c> would — including a membership that became <c>Inactive</c> as a result of
/// the very event being notified. Guests and memberships of other squads are never resolved.
/// </para>
/// <para>
/// The store is designed for reuse by the fan-out and email tasks (4.4/4.6): <see cref="Added"/> exposes
/// the persisted in-app records so those tasks can assert one <c>Unread</c> record per recipient.
/// </para>
/// </summary>
internal sealed class NotificationStore
{
    private readonly List<SquadMembership> _memberships = new();
    private readonly List<InAppNotification> _staged = new();
    private readonly List<InAppNotification> _committed = new();
    private readonly Dictionary<Guid, string> _emailsByMembership = new();

    /// <summary>
    /// The in-app notifications that have been <b>committed</b> by a successful
    /// <see cref="NotificationPublishFakeUnitOfWork.SaveChangesAsync"/>. Records staged by
    /// <see cref="FakeNotificationRepository.AddAsync"/> are <i>not</i> surfaced here until the unit of
    /// work commits, so this models a real unit-of-work's all-or-nothing semantics: staged-but-uncommitted
    /// records (a failed or cancelled publish) are never observable as persisted (design Property 8).
    /// </summary>
    public IReadOnlyList<InAppNotification> Added => _committed;

    /// <summary>The in-app notifications staged but not yet committed (pending the next save).</summary>
    public IReadOnlyList<InAppNotification> Staged => _staged;

    /// <summary>Seeds a membership into the population recipients are resolved from.</summary>
    public void AddMembership(SquadMembership membership) => _memberships.Add(membership);

    /// <summary>
    /// Records the deliverable email address of a recipient membership's backing user, so
    /// <see cref="ResolveRecipientEmails"/> can return it. Passing a <see langword="null"/> or empty
    /// address models a user with no deliverable email — that membership is then omitted from the resolved
    /// map and the publisher skips its email as a non-error (design Property 12 / Requirement 6.6). The
    /// default population has no emails recorded, so a test that does not care about email resolves to an
    /// empty map and attempts no sends.
    /// </summary>
    public void SetEmail(Guid membershipId, string? email)
    {
        if (string.IsNullOrEmpty(email))
        {
            _emailsByMembership.Remove(membershipId);
            return;
        }

        _emailsByMembership[membershipId] = email;
    }

    /// <summary>
    /// Resolves the deliverable email of each supplied recipient membership id that is a registered
    /// membership of <paramref name="squadId"/> and has a recorded, non-empty address — mirroring the
    /// documented <see cref="INotificationRepository.ResolveRecipientEmailsAsync"/> join. Memberships with
    /// no recorded email, guests, and memberships of other squads are omitted from the map.
    /// </summary>
    public IReadOnlyDictionary<Guid, string> ResolveRecipientEmails(Guid squadId, IReadOnlyCollection<Guid> membershipIds)
    {
        var wanted = membershipIds.ToHashSet();
        return _memberships
            .Where(m => m.SquadId == squadId && !m.IsGuest && wanted.Contains(m.Id))
            .Where(m => _emailsByMembership.ContainsKey(m.Id))
            .DistinctBy(m => m.Id)
            .ToDictionary(m => m.Id, m => _emailsByMembership[m.Id]);
    }

    /// <summary>Stages an in-app notification the publish handler asked to add, pending a commit.</summary>
    public void RecordAdd(InAppNotification notification) => _staged.Add(notification);

    /// <summary>
    /// Commits every staged record, moving it into the observable <see cref="Added"/> set, and returns the
    /// number committed. Called by the fake unit of work on a successful save.
    /// </summary>
    public int CommitStaged()
    {
        int count = _staged.Count;
        _committed.AddRange(_staged);
        _staged.Clear();
        return count;
    }

    /// <summary>
    /// Discards every staged record without committing it, modelling a rolled-back transaction so no
    /// partial set ever becomes observable. Called by the fake unit of work on a failed or cancelled save.
    /// </summary>
    public void DiscardStaged() => _staged.Clear();

    /// <summary>
    /// Resolves the broadcast target set: the owning squad's registered (user-backed) memberships whose
    /// state is <see cref="MembershipState.Active"/>. Each matching membership appears once.
    /// </summary>
    public IReadOnlyList<SquadMembership> ListActiveRegistered(Guid squadId) =>
        _memberships
            .Where(m => m.SquadId == squadId && !m.IsGuest && m.State == MembershipState.Active)
            .DistinctBy(m => m.Id)
            .ToList();

    /// <summary>
    /// Resolves the directed target set: those <paramref name="ids"/> that are registered memberships of
    /// the owning squad, active or inactive. Each matching membership appears once regardless of how
    /// many times its id was supplied (mirroring SQL set-membership semantics), so duplicate ids collapse.
    /// </summary>
    public IReadOnlyList<SquadMembership> ResolveRegistered(Guid squadId, IReadOnlyCollection<Guid> ids)
    {
        var wanted = ids.ToHashSet();
        return _memberships
            .Where(m => m.SquadId == squadId && !m.IsGuest && wanted.Contains(m.Id))
            .DistinctBy(m => m.Id)
            .ToList();
    }
}

/// <summary>
/// In-memory <see cref="INotificationRepository"/> over a <see cref="NotificationStore"/>. It faithfully
/// implements the two recipient-targeting queries the publish handler drives, records which query was
/// invoked and with what arguments, captures the resolved recipient set it handed back (the recipients
/// that would be persisted), and records <c>AddAsync</c> calls into the store. The read-model and
/// lifecycle-removal members are not exercised by the recipient-targeting properties and throw
/// <see cref="NotSupportedException"/> so any accidental use is loud rather than silent.
/// </summary>
internal sealed class FakeNotificationRepository : INotificationRepository
{
    private readonly NotificationStore _store;

    public FakeNotificationRepository(NotificationStore store) => _store = store;

    /// <summary>The number of times the broadcast resolution query was invoked.</summary>
    public int ListActiveRegisteredCallCount { get; private set; }

    /// <summary>The number of times the directed resolution query was invoked.</summary>
    public int ResolveRegisteredCallCount { get; private set; }

    /// <summary>The squad id passed to the most recent resolution query, or <see langword="null"/> if none ran.</summary>
    public Guid? LastResolvedSquadId { get; private set; }

    /// <summary>The directed ids passed to the most recent directed resolution query, or <see langword="null"/>.</summary>
    public IReadOnlyList<Guid>? LastDirectedIds { get; private set; }

    /// <summary>
    /// The recipient set returned by the most recent resolution query — the memberships that would be
    /// persisted as recipients. Empty until a resolution query runs.
    /// </summary>
    public IReadOnlyList<SquadMembership> LastResolvedRecipients { get; private set; } = [];

    /// <summary>True once any resolution query has been invoked.</summary>
    public bool AnyResolutionInvoked => ListActiveRegisteredCallCount + ResolveRegisteredCallCount > 0;

    public Task AddAsync(InAppNotification notification, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        ArgumentNullException.ThrowIfNull(notification);
        _store.RecordAdd(notification);
        return Task.CompletedTask;
    }

    public Task<IReadOnlyList<SquadMembership>> ListActiveRegisteredAsync(Guid squadId, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        ListActiveRegisteredCallCount++;
        LastResolvedSquadId = squadId;
        IReadOnlyList<SquadMembership> resolved = _store.ListActiveRegistered(squadId);
        LastResolvedRecipients = resolved;
        return Task.FromResult(resolved);
    }

    public Task<IReadOnlyList<SquadMembership>> ResolveRegisteredAsync(Guid squadId, IReadOnlyCollection<Guid> ids, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        ArgumentNullException.ThrowIfNull(ids);
        ResolveRegisteredCallCount++;
        LastResolvedSquadId = squadId;
        LastDirectedIds = ids.ToList();
        IReadOnlyList<SquadMembership> resolved = _store.ResolveRegistered(squadId, ids);
        LastResolvedRecipients = resolved;
        return Task.FromResult(resolved);
    }

    /// <summary>The number of times the recipient-email resolution query was invoked.</summary>
    public int ResolveRecipientEmailsCallCount { get; private set; }

    /// <summary>
    /// When set, thrown by <see cref="ResolveRecipientEmailsAsync"/> to model a failure resolving the email
    /// batch, so the email/isolation tests (task 4.6) can assert the failure is isolated from the committed
    /// in-app records and the publish result. Left <see langword="null"/> for the default happy path.
    /// </summary>
    public Exception? ResolveRecipientEmailsThrows { get; set; }

    public Task<IReadOnlyDictionary<Guid, string>> ResolveRecipientEmailsAsync(
        Guid squadId, IReadOnlyCollection<Guid> membershipIds, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        ArgumentNullException.ThrowIfNull(membershipIds);
        ResolveRecipientEmailsCallCount++;

        if (ResolveRecipientEmailsThrows is not null)
        {
            throw ResolveRecipientEmailsThrows;
        }

        return Task.FromResult(_store.ResolveRecipientEmails(squadId, membershipIds));
    }

    public Task<IReadOnlyList<InAppNotification>> ListForUserAsync(Guid userId, Guid? squadId, int limit, CancellationToken ct) =>
        throw new NotSupportedException("The read model is not exercised by the recipient-targeting properties.");

    public Task<int> CountUnreadForUserAsync(Guid userId, Guid? squadId, CancellationToken ct) =>
        throw new NotSupportedException("The read model is not exercised by the recipient-targeting properties.");

    public Task<InAppNotification?> GetForUserAsync(Guid notificationId, Guid userId, CancellationToken ct) =>
        throw new NotSupportedException("The read model is not exercised by the recipient-targeting properties.");

    public Task<IReadOnlyList<InAppNotification>> ListUnreadForUserAsync(Guid userId, Guid? squadId, CancellationToken ct) =>
        throw new NotSupportedException("The read model is not exercised by the recipient-targeting properties.");

    public Task<bool> UserHasMembershipInSquadAsync(Guid userId, Guid squadId, CancellationToken ct) =>
        throw new NotSupportedException("The read model is not exercised by the recipient-targeting properties.");

    public Task RemoveForUserAsync(Guid userId, CancellationToken ct) =>
        throw new NotSupportedException("Lifecycle removal is not exercised by the recipient-targeting properties.");

    public Task RemoveForMembershipAsync(Guid membershipId, CancellationToken ct) =>
        throw new NotSupportedException("Lifecycle removal is not exercised by the recipient-targeting properties.");

    public Task RemoveForSquadAsync(Guid squadId, CancellationToken ct) =>
        throw new NotSupportedException("Lifecycle removal is not exercised by the recipient-targeting properties.");
}

/// <summary>
/// A fake <see cref="IUnitOfWork"/> for the notification publish tests, modelling a real unit-of-work's
/// all-or-nothing commit against a <see cref="NotificationStore"/>. When given a <paramref name="store"/>,
/// a successful save <b>commits</b> the store's staged records (surfacing them via
/// <see cref="NotificationStore.Added"/>) and returns the number committed; a failed or cancelled save
/// discards the staged records so no partial set is ever observable (design Property 8).
/// <list type="bullet">
/// <item>A save constructed with <c>throwOnSave: true</c> throws, modelling a mid-publish persistence
/// failure — the staged records are discarded and never committed.</item>
/// <item>A save constructed with a <c>cancelOnSave</c> source signals that token at the commit point,
/// modelling a <see cref="CancellationToken"/> that becomes signalled just before the commit — the staged
/// records are discarded and an <see cref="OperationCanceledException"/> is observed.</item>
/// </list>
/// </summary>
internal sealed class NotificationPublishFakeUnitOfWork : IUnitOfWork
{
    private readonly NotificationStore? _store;
    private readonly bool _throwOnSave;
    private readonly CancellationTokenSource? _cancelOnSave;

    public NotificationPublishFakeUnitOfWork(
        NotificationStore? store = null,
        bool throwOnSave = false,
        CancellationTokenSource? cancelOnSave = null)
    {
        _store = store;
        _throwOnSave = throwOnSave;
        _cancelOnSave = cancelOnSave;
    }

    /// <summary>The number of times <see cref="SaveChangesAsync"/> has been invoked.</summary>
    public int SaveCount { get; private set; }

    public Task<int> SaveChangesAsync(CancellationToken cancellationToken)
    {
        SaveCount++;

        // Model a cancellation observed at the commit point (Requirement 5.8): the token becomes signalled
        // just as the unit of work would commit, so nothing is committed.
        _cancelOnSave?.Cancel();

        if (cancellationToken.IsCancellationRequested)
        {
            _store?.DiscardStaged();
            cancellationToken.ThrowIfCancellationRequested();
        }

        if (_throwOnSave)
        {
            _store?.DiscardStaged();
            throw new InvalidOperationException("Simulated persistence failure during a notification publish.");
        }

        int committed = _store?.CommitStaged() ?? 0;
        return Task.FromResult(committed);
    }
}

/// <summary>
/// Factory helpers for building the mixed membership population the recipient-targeting properties draw
/// on. Guest creation records its lawful-basis acknowledgement instant from a controllable
/// <see cref="FakeTimeProvider"/> so the fakes stay clock-driven and deterministic.
/// </summary>
internal static class NotificationMembershipFactory
{
    private static readonly FakeTimeProvider Clock = new(DateTimeOffset.Parse("2025-01-01T00:00:00Z"));

    /// <summary>Builds an active registered membership of <paramref name="squadId"/>.</summary>
    public static SquadMembership RegisteredActive(Guid squadId, string displayName) =>
        SquadMembership.CreateRegistered(squadId, Guid.CreateVersion7(), displayName).Value!;

    /// <summary>Builds a registered membership of <paramref name="squadId"/> that has been deactivated.</summary>
    public static SquadMembership RegisteredInactive(Guid squadId, string displayName)
    {
        SquadMembership membership = SquadMembership.CreateRegistered(squadId, Guid.CreateVersion7(), displayName).Value!;
        membership.Deactivate();
        return membership;
    }

    /// <summary>Builds an active guest membership of <paramref name="squadId"/> (never a recipient).</summary>
    public static SquadMembership Guest(Guid squadId, string displayName) =>
        SquadMembership.CreateGuest(squadId, displayName, skillTier: (SkillTier?)null, Clock.GetUtcNow()).Value!;

    /// <summary>A minimal, always-valid rendering context for a publish call.</summary>
    public static NotificationContext Context() => new() { SquadName = "The Squad" };
}

/// <summary>
/// A deterministic in-memory <see cref="INotificationEmailRenderer"/> for the publish tests. It records
/// every render call (type + recipient address) and returns a per-type distinct subject and body. The
/// email/isolation tests (task 4.6) reuse it to assert that a rendered message is only ever produced for a
/// recipient with a deliverable address, and can inspect <see cref="Rendered"/>. An optional
/// <see cref="RenderThrows"/> models a rendering failure that must be isolated like any other email failure.
/// </summary>
internal sealed class FakeNotificationEmailRenderer : INotificationEmailRenderer
{
    private readonly List<(NotificationType Type, string RecipientEmail)> _rendered = new();
    private readonly List<EmailMessage> _messages = new();

    /// <summary>The render calls made, in order — the type and the recipient address each was rendered for.</summary>
    public IReadOnlyList<(NotificationType Type, string RecipientEmail)> Rendered => _rendered;

    /// <summary>
    /// The full <see cref="EmailMessage"/> produced by each render call, in order. The email-isolation
    /// tests (task 4.6, Property 11) read the exact rendered subject and body from here so they can assert
    /// those precise strings never appear in any captured failure log entry (Requirement 6.4). Both the
    /// subject and the body embed <see cref="NotificationContext.SquadName"/>, so a test that supplies a
    /// distinctive squad name gets a distinctive subject and body to search for.
    /// </summary>
    public IReadOnlyList<EmailMessage> Messages => _messages;

    /// <summary>When set, thrown by <see cref="Render"/> to model a rendering failure the publisher must isolate.</summary>
    public Exception? RenderThrows { get; set; }

    public EmailMessage Render(NotificationType type, string recipientEmail, NotificationContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        _rendered.Add((type, recipientEmail));

        if (RenderThrows is not null)
        {
            throw RenderThrows;
        }

        var message = new EmailMessage(
            recipientEmail,
            $"[{type}] subject for {context.SquadName}",
            $"[{type}] body for {context.SquadName}");
        _messages.Add(message);
        return message;
    }
}

/// <summary>
/// A configurable in-memory <see cref="IEmailSender"/> for the publish tests. By default every send
/// succeeds. The email/isolation tests (task 4.6) set <see cref="Behaviour"/> to model per-recipient
/// success, a failure <see cref="AuthResult"/>, a thrown exception, or a slow send that exceeds the
/// publisher's 30-second timeout (await the supplied token to be cancelled). Every attempt is recorded in
/// <see cref="Sent"/> as it is received, so a test can assert which recipients the fan-out attempted.
/// </summary>
internal sealed class FakeEmailSender : IEmailSender
{
    private readonly List<EmailMessage> _sent = new();

    /// <summary>Every message the handler attempted to send, in order, recorded on entry (before the outcome).</summary>
    public IReadOnlyList<EmailMessage> Sent => _sent;

    /// <summary>
    /// The per-attempt outcome. When <see langword="null"/> (the default) every send succeeds. A test can
    /// return a failure <see cref="AuthResult"/>, throw, or await <paramref name="ct"/> to model a timeout.
    /// </summary>
    public Func<EmailMessage, CancellationToken, Task<AuthResult>>? Behaviour { get; set; }

    public async Task<AuthResult> SendAsync(EmailMessage message, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(message);
        _sent.Add(message);

        if (Behaviour is not null)
        {
            return await Behaviour(message, cancellationToken);
        }

        return AuthResult.Ok();
    }
}

/// <summary>
/// A capturing <see cref="ILogger{TCategoryName}"/> that records each entry's level, formatted message,
/// and the individual state key/value pairs. The email-isolation tests (task 4.6) use it to assert that a
/// failure log carries the notification type, squad id, and recipient membership id, and never the rendered
/// subject, rendered body, or recipient email address (Requirement 6.4).
/// </summary>
internal sealed class CapturingLogger<T> : ILogger<T>
{
    private readonly List<CapturedLogEntry> _entries = new();

    /// <summary>The captured log entries, in order.</summary>
    public IReadOnlyList<CapturedLogEntry> Entries => _entries;

    public IDisposable BeginScope<TState>(TState state) where TState : notnull => NullScope.Instance;

    public bool IsEnabled(LogLevel logLevel) => true;

    public void Log<TState>(
        LogLevel logLevel,
        EventId eventId,
        TState state,
        Exception? exception,
        Func<TState, Exception?, string> formatter)
    {
        ArgumentNullException.ThrowIfNull(formatter);

        var values = new Dictionary<string, object?>();
        if (state is IReadOnlyList<KeyValuePair<string, object?>> pairs)
        {
            foreach (KeyValuePair<string, object?> pair in pairs)
            {
                values[pair.Key] = pair.Value;
            }
        }

        _entries.Add(new CapturedLogEntry(logLevel, formatter(state, exception), values));
    }

    private sealed class NullScope : IDisposable
    {
        public static readonly NullScope Instance = new();
        public void Dispose() { }
    }
}

/// <summary>A single captured log entry: its level, its formatted message, and its structured state values.</summary>
internal sealed record CapturedLogEntry(
    LogLevel Level, string Message, IReadOnlyDictionary<string, object?> Values);
