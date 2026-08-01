using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Notifications;
using PitchMate.Domain.Notifications;

namespace PitchMate.Application.Tests.Notifications;

/// <summary>
/// A hand-written, in-memory backing store for the mark-read property tests (design Properties 14 and
/// 15). It holds a mixed population of <see cref="InAppNotification"/> records, each tagged with the
/// id of the user that backs its recipient membership (the "owner"), across several squads and read
/// states, plus the set of squads each user holds a membership in. This is a real fake — list-backed
/// implementations of the <see cref="INotificationRepository"/> read/mutate surface the mark-read
/// handlers drive — not a mocking-framework stub and not a database.
/// <para>
/// Because the handlers mutate the very <see cref="InAppNotification"/> instances the store hands back,
/// the store observes read-state flips directly through the shared references, so a test can assert
/// which records changed and which were left untouched.
/// </para>
/// </summary>
internal sealed class MarkReadNotificationStore
{
    private readonly List<OwnedNotification> _records = new();
    private readonly HashSet<(Guid UserId, Guid SquadId)> _memberships = new();

    /// <summary>Every stored record paired with the id of the user that backs its recipient membership.</summary>
    public IReadOnlyList<OwnedNotification> Records => _records;

    /// <summary>
    /// Seeds one notification owned by <paramref name="ownerUserId"/> in <paramref name="squadId"/> with
    /// the given initial <paramref name="state"/>. A <see cref="ReadState.Read"/> record is produced by
    /// creating an <see cref="ReadState.Unread"/> record (the only creation state) and marking it read.
    /// The backing user is also granted a membership in that squad so squad-scoped requests resolve.
    /// </summary>
    public InAppNotification Seed(Guid ownerUserId, Guid squadId, ReadState state)
    {
        InAppNotification record = InAppNotification
            .Create(squadId, Guid.CreateVersion7(), NotificationType.MemberJoined, "Title", "Body")
            .Value!;

        if (state == ReadState.Read)
        {
            record.MarkRead();
        }

        _records.Add(new OwnedNotification(ownerUserId, record));
        _memberships.Add((ownerUserId, squadId));
        return record;
    }

    /// <summary>Grants <paramref name="userId"/> a membership of any state in <paramref name="squadId"/>.</summary>
    public void GrantMembership(Guid userId, Guid squadId) => _memberships.Add((userId, squadId));

    /// <summary>
    /// Resolves the notification identified by <paramref name="notificationId"/> only when it is owned by
    /// <paramref name="userId"/>; otherwise <see langword="null"/> so existence is never disclosed for a
    /// record the caller does not own.
    /// </summary>
    public InAppNotification? GetForUser(Guid notificationId, Guid userId) =>
        _records
            .FirstOrDefault(r => r.Record.Id == notificationId && r.OwnerUserId == userId)
            ?.Record;

    /// <summary>
    /// Resolves the caller's own <see cref="ReadState.Unread"/> records, optionally scoped to a single
    /// squad — mirroring the documented <see cref="INotificationRepository.ListUnreadForUserAsync"/>
    /// contract. Records owned by another user, records that are already <see cref="ReadState.Read"/>, and
    /// records outside the requested squad are excluded.
    /// </summary>
    public IReadOnlyList<InAppNotification> ListUnreadForUser(Guid userId, Guid? squadId) =>
        _records
            .Where(r => r.OwnerUserId == userId
                && r.Record.ReadState == ReadState.Unread
                && (squadId is null || r.Record.SquadId == squadId))
            .Select(r => r.Record)
            .ToList();

    /// <summary>Whether <paramref name="userId"/> holds a membership of any state in <paramref name="squadId"/>.</summary>
    public bool UserHasMembershipInSquad(Guid userId, Guid squadId) =>
        _memberships.Contains((userId, squadId));

    /// <summary>A stored notification paired with the id of the user that backs its recipient membership.</summary>
    internal sealed record OwnedNotification(Guid OwnerUserId, InAppNotification Record);
}

/// <summary>
/// In-memory <see cref="INotificationRepository"/> over a <see cref="MarkReadNotificationStore"/>,
/// implementing only the three read/mutate members the mark-read handlers drive
/// (<see cref="GetForUserAsync"/>, <see cref="ListUnreadForUserAsync"/>,
/// <see cref="UserHasMembershipInSquadAsync"/>). The remaining members are not exercised by the
/// mark-read properties and throw <see cref="NotSupportedException"/> so any accidental use is loud
/// rather than silent.
/// </summary>
internal sealed class FakeMarkReadNotificationRepository : INotificationRepository
{
    private readonly MarkReadNotificationStore _store;

    public FakeMarkReadNotificationRepository(MarkReadNotificationStore store) => _store = store;

    public Task<InAppNotification?> GetForUserAsync(Guid notificationId, Guid userId, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        return Task.FromResult(_store.GetForUser(notificationId, userId));
    }

    public Task<IReadOnlyList<InAppNotification>> ListUnreadForUserAsync(Guid userId, Guid? squadId, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        return Task.FromResult(_store.ListUnreadForUser(userId, squadId));
    }

    public Task<bool> UserHasMembershipInSquadAsync(Guid userId, Guid squadId, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        return Task.FromResult(_store.UserHasMembershipInSquad(userId, squadId));
    }

    public Task AddAsync(InAppNotification notification, CancellationToken ct) =>
        throw new NotSupportedException("The publish path is not exercised by the mark-read properties.");

    public Task<IReadOnlyList<PitchMate.Domain.Squads.SquadMembership>> ListActiveRegisteredAsync(Guid squadId, CancellationToken ct) =>
        throw new NotSupportedException("Recipient targeting is not exercised by the mark-read properties.");

    public Task<IReadOnlyList<PitchMate.Domain.Squads.SquadMembership>> ResolveRegisteredAsync(
        Guid squadId, IReadOnlyCollection<Guid> ids, CancellationToken ct) =>
        throw new NotSupportedException("Recipient targeting is not exercised by the mark-read properties.");

    public Task<IReadOnlyDictionary<Guid, string>> ResolveRecipientEmailsAsync(
        Guid squadId, IReadOnlyCollection<Guid> membershipIds, CancellationToken ct) =>
        throw new NotSupportedException("Email resolution is not exercised by the mark-read properties.");

    public Task<IReadOnlyList<InAppNotification>> ListForUserAsync(Guid userId, Guid? squadId, int limit, CancellationToken ct) =>
        throw new NotSupportedException("The listing read model is not exercised by the mark-read properties.");

    public Task<int> CountUnreadForUserAsync(Guid userId, Guid? squadId, CancellationToken ct) =>
        throw new NotSupportedException("The unread-count read model is not exercised by the mark-read properties.");

    public Task RemoveForUserAsync(Guid userId, CancellationToken ct) =>
        throw new NotSupportedException("Lifecycle removal is not exercised by the mark-read properties.");

    public Task RemoveForMembershipAsync(Guid membershipId, CancellationToken ct) =>
        throw new NotSupportedException("Lifecycle removal is not exercised by the mark-read properties.");

    public Task RemoveForSquadAsync(Guid squadId, CancellationToken ct) =>
        throw new NotSupportedException("Lifecycle removal is not exercised by the mark-read properties.");
}

/// <summary>
/// A minimal <see cref="IUnitOfWork"/> for the mark-read property tests. The handlers mutate the stored
/// <see cref="InAppNotification"/> instances in place, so a commit needs no store interaction; this fake
/// simply records how many times the read-state flips were committed and reports zero state-changed
/// entities.
/// </summary>
internal sealed class FakeMarkReadUnitOfWork : IUnitOfWork
{
    /// <summary>The number of times <see cref="SaveChangesAsync"/> has been invoked.</summary>
    public int SaveCount { get; private set; }

    public Task<int> SaveChangesAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        SaveCount++;
        return Task.FromResult(0);
    }
}
