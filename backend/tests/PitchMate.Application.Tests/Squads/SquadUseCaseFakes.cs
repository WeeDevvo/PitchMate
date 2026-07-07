using PitchMate.Application.Auth.Abstractions;
using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Auth;
using PitchMate.Domain.Squads;

namespace PitchMate.Application.Tests.Squads;

/// <summary>
/// A hand-written, in-memory backing store shared by the squad use-case test doubles. It models the
/// Unit-of-Work boundary faithfully: repository <c>AddAsync</c> calls only <em>stage</em> entities,
/// and they become committed only when <see cref="Commit"/> runs as part of a successful
/// <see cref="FakeSquadUnitOfWork.SaveChangesAsync"/>; a failing save <see cref="DiscardPending">discards</see>
/// staged entities so nothing is persisted. Committed users, squads, memberships, and per-squad
/// soft-delete markers can also be seeded directly for read-path tests. This is a real fake
/// (dictionary/list-backed implementations of the Application contracts), not a mocking-framework stub
/// and not a database.
/// </summary>
internal sealed class SquadStore
{
    private readonly Dictionary<Guid, User> _users = new();
    private readonly Dictionary<Guid, Squad> _squads = new();
    private readonly HashSet<Guid> _deletedSquads = new();
    private readonly List<SquadMembership> _memberships = new();

    private readonly List<Squad> _pendingSquads = new();
    private readonly List<SquadMembership> _pendingMemberships = new();

    /// <summary>The squads durably committed so far, keyed by identity.</summary>
    public IReadOnlyDictionary<Guid, Squad> Squads => _squads;

    /// <summary>The memberships durably committed so far.</summary>
    public IReadOnlyList<SquadMembership> Memberships => _memberships;

    /// <summary>The number of times a save was attempted against this store.</summary>
    public int SaveCallCount { get; private set; }

    /// <summary>Seeds a committed user available for owner-display-name derivation.</summary>
    public void AddUser(User user) => _users[user.Id] = user;

    /// <summary>Seeds a committed squad, optionally marked soft-deleted, for read-path tests.</summary>
    public void AddCommittedSquad(Squad squad, bool softDeleted = false)
    {
        _squads[squad.Id] = squad;
        if (softDeleted)
        {
            _deletedSquads.Add(squad.Id);
        }
    }

    /// <summary>Seeds a committed membership for read-path tests.</summary>
    public void AddCommittedMembership(SquadMembership membership) => _memberships.Add(membership);

    /// <summary>Stages a squad for insertion on the next successful save.</summary>
    public void StageSquad(Squad squad) => _pendingSquads.Add(squad);

    /// <summary>Stages a membership for insertion on the next successful save.</summary>
    public void StageMembership(SquadMembership membership) => _pendingMemberships.Add(membership);

    /// <summary>Records that a save was attempted.</summary>
    public void RecordSaveCall() => SaveCallCount++;

    /// <summary>Atomically commits every staged squad and membership together, returning the row count.</summary>
    public int Commit()
    {
        int count = _pendingSquads.Count + _pendingMemberships.Count;
        foreach (Squad squad in _pendingSquads)
        {
            _squads[squad.Id] = squad;
        }

        _memberships.AddRange(_pendingMemberships);
        _pendingSquads.Clear();
        _pendingMemberships.Clear();
        return count;
    }

    /// <summary>Discards staged entities without committing, modelling a rolled-back save.</summary>
    public void DiscardPending()
    {
        _pendingSquads.Clear();
        _pendingMemberships.Clear();
    }

    /// <summary>Finds a committed user by identity, or <see langword="null"/>.</summary>
    public User? FindUser(Guid id) => _users.GetValueOrDefault(id);

    /// <summary>Finds a committed, non-deleted squad by identity, or <see langword="null"/>.</summary>
    public Squad? FindSquad(Guid id) =>
        !_deletedSquads.Contains(id) && _squads.TryGetValue(id, out Squad? squad) ? squad : null;

    /// <summary>Finds a committed squad including soft-deleted ones, or <see langword="null"/>.</summary>
    public Squad? FindSquadIncludingDeleted(Guid id) => _squads.GetValueOrDefault(id);

    /// <summary>Lists the committed, non-deleted squads in which the user holds a membership.</summary>
    public IReadOnlyList<Squad> ListSquadsForUser(Guid userId)
    {
        var squadIds = _memberships
            .Where(m => m.UserId == userId)
            .Select(m => m.SquadId)
            .Distinct();

        return squadIds
            .Where(id => !_deletedSquads.Contains(id))
            .Select(id => _squads.GetValueOrDefault(id))
            .Where(s => s is not null)
            .Select(s => s!)
            .ToList();
    }

    /// <summary>Finds the user's committed membership in a squad, or <see langword="null"/>.</summary>
    public SquadMembership? FindMembership(Guid userId, Guid squadId) =>
        _memberships.FirstOrDefault(m => m.UserId == userId && m.SquadId == squadId);

    /// <summary>Finds a committed membership by identity, or <see langword="null"/>.</summary>
    public SquadMembership? FindMembershipById(Guid membershipId) =>
        _memberships.FirstOrDefault(m => m.Id == membershipId);

    /// <summary>Lists the committed memberships of a squad, optionally restricted to active ones.</summary>
    public IReadOnlyList<SquadMembership> ListMembershipsForSquad(Guid squadId, bool activeOnly) =>
        _memberships
            .Where(m => m.SquadId == squadId && (!activeOnly || m.State == MembershipState.Active))
            .ToList();
}

/// <summary>In-memory <see cref="ISquadRepository"/> over a <see cref="SquadStore"/>.</summary>
internal sealed class FakeSquadRepository : ISquadRepository
{
    private readonly SquadStore _store;

    public FakeSquadRepository(SquadStore store) => _store = store;

    public Task AddAsync(Squad squad, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        ArgumentNullException.ThrowIfNull(squad);
        _store.StageSquad(squad);
        return Task.CompletedTask;
    }

    public Task<Squad?> GetByIdAsync(Guid squadId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(_store.FindSquad(squadId));
    }

    public Task<Squad?> GetByIdIncludingDeletedAsync(Guid squadId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(_store.FindSquadIncludingDeleted(squadId));
    }

    public Task<IReadOnlyList<Squad>> ListForUserAsync(Guid userId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(_store.ListSquadsForUser(userId));
    }

    public Task<IReadOnlyList<Squad>> ListPurgeDueAsync(DateTimeOffset now, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        IReadOnlyList<Squad> due = [];
        return Task.FromResult(due);
    }
}

/// <summary>In-memory <see cref="ISquadMembershipRepository"/> over a <see cref="SquadStore"/>.</summary>
internal sealed class FakeSquadMembershipRepository : ISquadMembershipRepository
{
    private readonly SquadStore _store;

    public FakeSquadMembershipRepository(SquadStore store) => _store = store;

    public Task AddAsync(SquadMembership membership, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        ArgumentNullException.ThrowIfNull(membership);
        _store.StageMembership(membership);
        return Task.CompletedTask;
    }

    public Task<SquadMembership?> GetByIdAsync(Guid membershipId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(_store.FindMembershipById(membershipId));
    }

    public Task<SquadMembership?> GetByUserAndSquadAsync(Guid userId, Guid squadId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(_store.FindMembership(userId, squadId));
    }

    public Task<IReadOnlyList<SquadMembership>> ListForSquadAsync(Guid squadId, bool activeOnly, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(_store.ListMembershipsForSquad(squadId, activeOnly));
    }

    public Task<SquadMembership?> GetOwnerAsync(Guid squadId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        SquadMembership? owner = _store
            .ListMembershipsForSquad(squadId, activeOnly: false)
            .FirstOrDefault(m => m.Role == SquadRole.Owner);
        return Task.FromResult(owner);
    }

    public Task<bool> DisplayNameTakenAsync(Guid squadId, string normalisedName, Guid? excludingMembershipId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        bool taken = _store
            .ListMembershipsForSquad(squadId, activeOnly: false)
            .Any(m => m.Id != excludingMembershipId
                && m.DisplayNameNormalized is not null
                && m.DisplayNameNormalized == normalisedName);
        return Task.FromResult(taken);
    }
}

/// <summary>In-memory <see cref="IUserRepository"/> over a <see cref="SquadStore"/>.</summary>
internal sealed class FakeUserRepository : IUserRepository
{
    private readonly SquadStore _store;

    public FakeUserRepository(SquadStore store) => _store = store;

    public Task<User?> GetByIdAsync(Guid id, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        return Task.FromResult(_store.FindUser(id));
    }

    public Task AddAsync(User user, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        ArgumentNullException.ThrowIfNull(user);
        _store.AddUser(user);
        return Task.CompletedTask;
    }
}

/// <summary>
/// A fake <see cref="IUnitOfWork"/> over a <see cref="SquadStore"/>. A normal save atomically commits
/// the staged entities; a save constructed with <c>throwOnSave: true</c> discards the staged entities
/// and throws, modelling a mid-operation persistence failure so atomicity can be asserted.
/// </summary>
internal sealed class FakeSquadUnitOfWork : IUnitOfWork
{
    private readonly SquadStore _store;
    private readonly bool _throwOnSave;

    public FakeSquadUnitOfWork(SquadStore store, bool throwOnSave = false)
    {
        _store = store;
        _throwOnSave = throwOnSave;
    }

    public Task<int> SaveChangesAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        _store.RecordSaveCall();

        if (_throwOnSave)
        {
            _store.DiscardPending();
            throw new InvalidOperationException("Induced save failure for atomicity testing.");
        }

        return Task.FromResult(_store.Commit());
    }
}
