using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Notifications;
using PitchMate.Domain.Notifications;
using PitchMate.Domain.Squads;

namespace PitchMate.Application.Tests.Notifications;

/// <summary>
/// A hand-written, in-memory backing store for the GDPR/lifecycle-removal property tests (design
/// Properties 19 and 20). It holds a mixed population of <see cref="InAppNotification"/> records, each
/// tagged with the id of the user that backs its recipient membership (the "owner") and mixed read
/// states, spread across several squads, several users, and — because one user has one membership per
/// squad — several memberships. This is a real fake (list-backed implementations of the three
/// <see cref="INotificationRepository"/> removal members the lifecycle handlers drive), not a
/// mocking-framework stub and not a database.
/// <para>
/// It models a real unit-of-work's all-or-nothing removal semantics. A <c>RemoveForXAsync</c> call
/// <b>stages</b> the matching records; only a successful
/// <see cref="LifecycleRemovalUnitOfWork.SaveChangesAsync"/> <b>commits</b> the removal — deleting the
/// staged rows from <see cref="Records"/> — while a failed or cancelled save
/// <see cref="DiscardRemovals">discards</see> the staging so no record within the scope is removed
/// (Requirement 11.7). Removal ignores read state entirely, matching the requirement that records are
/// removed "regardless of each record's read state" (Requirements 11.1, 11.2, 11.3).
/// </para>
/// </summary>
internal sealed class LifecycleRemovalStore
{
    private readonly List<OwnedNotification> _records = new();
    private readonly List<OwnedNotification> _stagedForRemoval = new();

    /// <summary>The records still present — those a successful removal has not committed away.</summary>
    public IReadOnlyList<OwnedNotification> Records => _records;

    /// <summary>
    /// Seeds one notification owned by <paramref name="ownerUserId"/>, addressed to
    /// <paramref name="membershipId"/> in <paramref name="squadId"/>, in the given initial
    /// <paramref name="state"/>. A <see cref="ReadState.Read"/> record is produced by creating an
    /// <see cref="ReadState.Unread"/> record (the only creation state) and marking it read, so both read
    /// states appear in the population and removal can be shown to ignore read state.
    /// </summary>
    public InAppNotification Seed(Guid ownerUserId, Guid squadId, Guid membershipId, ReadState state)
    {
        InAppNotification record = InAppNotification
            .Create(squadId, membershipId, NotificationType.MemberJoined, "Title", "Body")
            .Value!;

        if (state == ReadState.Read)
        {
            record.MarkRead();
        }

        _records.Add(new OwnedNotification(ownerUserId, record));
        return record;
    }

    /// <summary>Stages every record backed by <paramref name="userId"/>, across all squads (Requirement 11.1).</summary>
    public void StageRemoveForUser(Guid userId) =>
        _stagedForRemoval.AddRange(_records.Where(r => r.OwnerUserId == userId));

    /// <summary>Stages every record addressed to <paramref name="membershipId"/> (Requirement 11.2).</summary>
    public void StageRemoveForMembership(Guid membershipId) =>
        _stagedForRemoval.AddRange(_records.Where(r => r.Record.RecipientMembershipId == membershipId));

    /// <summary>Stages every record owned by <paramref name="squadId"/> (Requirement 11.3).</summary>
    public void StageRemoveForSquad(Guid squadId) =>
        _stagedForRemoval.AddRange(_records.Where(r => r.Record.SquadId == squadId));

    /// <summary>
    /// Commits every staged removal, deleting those rows from <see cref="Records"/>, and returns the
    /// number removed. Called by the fake unit of work on a successful save.
    /// </summary>
    public int CommitRemovals()
    {
        int count = _stagedForRemoval.Count;
        foreach (OwnedNotification staged in _stagedForRemoval)
        {
            _records.Remove(staged);
        }

        _stagedForRemoval.Clear();
        return count;
    }

    /// <summary>
    /// Discards every staged removal without deleting it, modelling a rolled-back transaction so no record
    /// within the scope is ever removed. Called by the fake unit of work on a failed or cancelled save.
    /// </summary>
    public void DiscardRemovals() => _stagedForRemoval.Clear();

    /// <summary>A stored notification paired with the id of the user that backs its recipient membership.</summary>
    internal sealed record OwnedNotification(Guid OwnerUserId, InAppNotification Record);
}

/// <summary>
/// In-memory <see cref="INotificationRepository"/> over a <see cref="LifecycleRemovalStore"/>,
/// implementing only the three lifecycle-removal members the removal handlers drive
/// (<see cref="RemoveForUserAsync"/>, <see cref="RemoveForMembershipAsync"/>,
/// <see cref="RemoveForSquadAsync"/>). Each stages its matching subset against the store, pending the
/// unit-of-work commit. An optional <see cref="RemoveThrows"/> models a staging failure the handler must
/// surface as <see cref="NotificationErrorCode.RemovalFailed"/> with nothing removed. Every other member
/// throws <see cref="NotSupportedException"/> so any accidental use is loud rather than silent.
/// </summary>
internal sealed class LifecycleRemovalNotificationRepository : INotificationRepository
{
    private readonly LifecycleRemovalStore _store;

    public LifecycleRemovalNotificationRepository(LifecycleRemovalStore store) => _store = store;

    /// <summary>The number of times any of the three removal-staging methods was invoked.</summary>
    public int RemoveCallCount { get; private set; }

    /// <summary>
    /// When set, thrown by every <c>RemoveForXAsync</c> to model a staging failure so the atomicity
    /// property can assert the removal is reported as failed and no record within the scope is removed.
    /// Left <see langword="null"/> for the happy path.
    /// </summary>
    public Exception? RemoveThrows { get; set; }

    public Task RemoveForUserAsync(Guid userId, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        RemoveCallCount++;
        if (RemoveThrows is not null)
        {
            throw RemoveThrows;
        }

        _store.StageRemoveForUser(userId);
        return Task.CompletedTask;
    }

    public Task RemoveForMembershipAsync(Guid membershipId, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        RemoveCallCount++;
        if (RemoveThrows is not null)
        {
            throw RemoveThrows;
        }

        _store.StageRemoveForMembership(membershipId);
        return Task.CompletedTask;
    }

    public Task RemoveForSquadAsync(Guid squadId, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        RemoveCallCount++;
        if (RemoveThrows is not null)
        {
            throw RemoveThrows;
        }

        _store.StageRemoveForSquad(squadId);
        return Task.CompletedTask;
    }

    public Task AddAsync(InAppNotification notification, CancellationToken ct) =>
        throw new NotSupportedException("Publishing is not exercised by the lifecycle-removal properties.");

    public Task<IReadOnlyList<SquadMembership>> ListActiveRegisteredAsync(Guid squadId, CancellationToken ct) =>
        throw new NotSupportedException("Targeting is not exercised by the lifecycle-removal properties.");

    public Task<IReadOnlyList<SquadMembership>> ResolveRegisteredAsync(Guid squadId, IReadOnlyCollection<Guid> ids, CancellationToken ct) =>
        throw new NotSupportedException("Targeting is not exercised by the lifecycle-removal properties.");

    public Task<IReadOnlyDictionary<Guid, string>> ResolveRecipientEmailsAsync(
        Guid squadId, IReadOnlyCollection<Guid> membershipIds, CancellationToken ct) =>
        throw new NotSupportedException("Email resolution is not exercised by the lifecycle-removal properties.");

    public Task<IReadOnlyList<InAppNotification>> ListForUserAsync(Guid userId, Guid? squadId, int limit, CancellationToken ct) =>
        throw new NotSupportedException("The read model is not exercised by the lifecycle-removal properties.");

    public Task<int> CountUnreadForUserAsync(Guid userId, Guid? squadId, CancellationToken ct) =>
        throw new NotSupportedException("The read model is not exercised by the lifecycle-removal properties.");

    public Task<InAppNotification?> GetForUserAsync(Guid notificationId, Guid userId, CancellationToken ct) =>
        throw new NotSupportedException("Single-record lookup is not exercised by the lifecycle-removal properties.");

    public Task<IReadOnlyList<InAppNotification>> ListUnreadForUserAsync(Guid userId, Guid? squadId, CancellationToken ct) =>
        throw new NotSupportedException("Mark-all-read listing is not exercised by the lifecycle-removal properties.");

    public Task<bool> UserHasMembershipInSquadAsync(Guid userId, Guid squadId, CancellationToken ct) =>
        throw new NotSupportedException("Scoping is not exercised by the lifecycle-removal properties.");
}

/// <summary>
/// A fake <see cref="IUnitOfWork"/> for the lifecycle-removal tests, modelling a real unit-of-work's
/// all-or-nothing commit against a <see cref="LifecycleRemovalStore"/>. A successful save commits the
/// store's staged removals (deleting them from <see cref="LifecycleRemovalStore.Records"/>) and returns
/// the number removed; a failed or cancelled save discards the staging so no record within the scope is
/// removed (design Property 20 / Requirement 11.7).
/// <list type="bullet">
/// <item>A save constructed with <c>throwOnSave: true</c> throws, modelling a commit failure — the staged
/// removals are discarded and never committed.</item>
/// <item>A save constructed with a <c>cancelOnSave</c> source signals that token at the commit point,
/// modelling a <see cref="CancellationToken"/> that becomes signalled just before the commit — the staged
/// removals are discarded and an <see cref="OperationCanceledException"/> is observed.</item>
/// </list>
/// </summary>
internal sealed class LifecycleRemovalUnitOfWork : IUnitOfWork
{
    private readonly LifecycleRemovalStore? _store;
    private readonly bool _throwOnSave;
    private readonly CancellationTokenSource? _cancelOnSave;

    public LifecycleRemovalUnitOfWork(
        LifecycleRemovalStore? store = null,
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

        // Model a cancellation observed at the commit point: the token becomes signalled just as the unit
        // of work would commit, so nothing is removed.
        _cancelOnSave?.Cancel();

        if (cancellationToken.IsCancellationRequested)
        {
            _store?.DiscardRemovals();
            cancellationToken.ThrowIfCancellationRequested();
        }

        if (_throwOnSave)
        {
            _store?.DiscardRemovals();
            throw new InvalidOperationException("Simulated persistence failure during a notification removal.");
        }

        int removed = _store?.CommitRemovals() ?? 0;
        return Task.FromResult(removed);
    }
}
