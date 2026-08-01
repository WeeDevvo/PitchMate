using PitchMate.Application.Notifications;
using PitchMate.Domain.Notifications;
using PitchMate.Domain.Squads;

namespace PitchMate.Application.Tests.Notifications;

/// <summary>
/// A hand-written, in-memory backing store for the notification <b>read-model</b> tests
/// (<see cref="ListNotificationsHandler"/> / <see cref="GetUnreadCountHandler"/>, design Properties
/// 16–18). It holds a mixed population of <see cref="SquadMembership"/> records (registered/guest,
/// active/inactive, across several squads and several backing users) together with the
/// <see cref="InAppNotification"/> records addressed to those memberships. It faithfully models the
/// documented, own-records-only <see cref="INotificationRepository"/> read surface: a record is "the
/// caller's own" exactly when its recipient membership is backed by the caller's user, decided by the
/// membership's <see cref="SquadMembership.UserId"/> and never by membership state — so a member
/// inactivated by removal still owns (and can read) their records (Requirements 9.1, 10.4, 10.6).
/// <para>
/// This is a real fake (list-backed implementations of the Application contract), not a mocking-framework
/// stub and not a database. It deliberately does <b>not</b> apply the ordering or the 200-record cap in
/// <see cref="ListForUser"/>: it returns every own-and-in-scope record in insertion order, so the stable
/// ordering and the cap are exercised on the handler itself (design Property 16).
/// </para>
/// </summary>
internal sealed class NotificationReadModelStore
{
    private readonly List<SquadMembership> _memberships = new();
    private readonly List<InAppNotification> _notifications = new();

    /// <summary>Seeds a membership into the population records are resolved against.</summary>
    public void AddMembership(SquadMembership membership) => _memberships.Add(membership);

    /// <summary>Seeds an in-app notification into the store.</summary>
    public void AddNotification(InAppNotification notification) => _notifications.Add(notification);

    /// <summary>The membership ids backed by <paramref name="userId"/> (a registered, user-backed membership of any state).</summary>
    private HashSet<Guid> MembershipsBackedBy(Guid userId) =>
        _memberships
            .Where(m => !m.IsGuest && m.UserId == userId)
            .Select(m => m.Id)
            .ToHashSet();

    /// <summary>
    /// Returns the caller's own notifications — records whose recipient membership is backed by
    /// <paramref name="userId"/> — optionally scoped to <paramref name="squadId"/>, in insertion order.
    /// The ordering and the cap are the handler's responsibility, so they are not applied here.
    /// </summary>
    public IReadOnlyList<InAppNotification> ListForUser(Guid userId, Guid? squadId)
    {
        HashSet<Guid> own = MembershipsBackedBy(userId);
        return _notifications
            .Where(n => own.Contains(n.RecipientMembershipId))
            .Where(n => squadId is null || n.SquadId == squadId.Value)
            .ToList();
    }

    /// <summary>
    /// Counts the caller's own <see cref="ReadState.Unread"/> notifications, optionally scoped to
    /// <paramref name="squadId"/> (Requirements 9.3, 9.4, 9.8).
    /// </summary>
    public int CountUnreadForUser(Guid userId, Guid? squadId)
    {
        HashSet<Guid> own = MembershipsBackedBy(userId);
        return _notifications
            .Count(n => own.Contains(n.RecipientMembershipId)
                && n.ReadState == ReadState.Unread
                && (squadId is null || n.SquadId == squadId.Value));
    }

    /// <summary>Whether <paramref name="userId"/> holds a membership of any state in <paramref name="squadId"/> (Requirement 10.4).</summary>
    public bool UserHasMembershipInSquad(Guid userId, Guid squadId) =>
        _memberships.Any(m => !m.IsGuest && m.UserId == userId && m.SquadId == squadId);
}

/// <summary>
/// In-memory <see cref="INotificationRepository"/> over a <see cref="NotificationReadModelStore"/> that
/// implements exactly the three read-surface members the listing and counting handlers drive
/// (<see cref="ListForUserAsync"/>, <see cref="CountUnreadForUserAsync"/>,
/// <see cref="UserHasMembershipInSquadAsync"/>). Every other member throws
/// <see cref="NotSupportedException"/> so any accidental use is loud rather than silent.
/// </summary>
internal sealed class ReadModelNotificationRepository : INotificationRepository
{
    private readonly NotificationReadModelStore _store;

    public ReadModelNotificationRepository(NotificationReadModelStore store) => _store = store;

    public Task<IReadOnlyList<InAppNotification>> ListForUserAsync(Guid userId, Guid? squadId, int limit, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        return Task.FromResult(_store.ListForUser(userId, squadId));
    }

    public Task<int> CountUnreadForUserAsync(Guid userId, Guid? squadId, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        return Task.FromResult(_store.CountUnreadForUser(userId, squadId));
    }

    public Task<bool> UserHasMembershipInSquadAsync(Guid userId, Guid squadId, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        return Task.FromResult(_store.UserHasMembershipInSquad(userId, squadId));
    }

    public Task AddAsync(InAppNotification notification, CancellationToken ct) =>
        throw new NotSupportedException("Publishing is not exercised by the read-model properties.");

    public Task<IReadOnlyList<SquadMembership>> ListActiveRegisteredAsync(Guid squadId, CancellationToken ct) =>
        throw new NotSupportedException("Targeting is not exercised by the read-model properties.");

    public Task<IReadOnlyList<SquadMembership>> ResolveRegisteredAsync(Guid squadId, IReadOnlyCollection<Guid> ids, CancellationToken ct) =>
        throw new NotSupportedException("Targeting is not exercised by the read-model properties.");

    public Task<IReadOnlyDictionary<Guid, string>> ResolveRecipientEmailsAsync(
        Guid squadId, IReadOnlyCollection<Guid> membershipIds, CancellationToken ct) =>
        throw new NotSupportedException("Email resolution is not exercised by the read-model properties.");

    public Task<InAppNotification?> GetForUserAsync(Guid notificationId, Guid userId, CancellationToken ct) =>
        throw new NotSupportedException("Single-record lookup is not exercised by the listing/counting properties.");

    public Task<IReadOnlyList<InAppNotification>> ListUnreadForUserAsync(Guid userId, Guid? squadId, CancellationToken ct) =>
        throw new NotSupportedException("Mark-all-read listing is not exercised by the listing/counting properties.");

    public Task RemoveForUserAsync(Guid userId, CancellationToken ct) =>
        throw new NotSupportedException("Lifecycle removal is not exercised by the read-model properties.");

    public Task RemoveForMembershipAsync(Guid membershipId, CancellationToken ct) =>
        throw new NotSupportedException("Lifecycle removal is not exercised by the read-model properties.");

    public Task RemoveForSquadAsync(Guid squadId, CancellationToken ct) =>
        throw new NotSupportedException("Lifecycle removal is not exercised by the read-model properties.");
}
