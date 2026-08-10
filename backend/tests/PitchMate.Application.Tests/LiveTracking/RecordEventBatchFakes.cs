using PitchMate.Application.Common;
using PitchMate.Application.Common.Persistence;
using PitchMate.Application.LiveTracking;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.LiveTracking;
using PitchMate.Domain.Matches;
using PitchMate.Domain.Squads;

namespace PitchMate.Application.Tests.LiveTracking;

/// <summary>
/// An append-only, in-memory <see cref="IMatchEventRepository"/> that mirrors the production
/// guarantee: <see cref="AppendAsync"/> only ever adds rows (it never updates or deletes), and events
/// are stored keyed by match so duplicate classification and derivation reads reflect exactly what was
/// appended. A commit is not modelled here — the harness's unit of work always succeeds — so appended
/// events are visible immediately, which is sufficient for the handler-level properties. It is a real
/// fake, not a mocking-framework stub.
/// </summary>
internal sealed class InMemoryMatchEventRepository : IMatchEventRepository
{
    private readonly Dictionary<Guid, List<MatchEvent>> _byMatch = new();

    /// <summary>The total number of stored events across every match, used to assert nothing was appended.</summary>
    public int TotalCount => _byMatch.Values.Sum(list => list.Count);

    /// <summary>Pre-seeds <paramref name="events"/> into the store as already-present events for their match.</summary>
    public void Seed(params MatchEvent[] events)
    {
        foreach (MatchEvent e in events)
        {
            Bucket(e.MatchId).Add(e);
        }
    }

    /// <summary>The stored events for <paramref name="matchId"/>, in append order.</summary>
    public IReadOnlyList<MatchEvent> Stored(Guid matchId) =>
        _byMatch.TryGetValue(matchId, out List<MatchEvent>? list) ? list : [];

    public Task<IReadOnlySet<Guid>> GetExistingEventIdsAsync(Guid matchId, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        IReadOnlySet<Guid> ids = Stored(matchId).Select(e => e.Id).ToHashSet();
        return Task.FromResult(ids);
    }

    public Task AppendAsync(IReadOnlyList<MatchEvent> events, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        ArgumentNullException.ThrowIfNull(events);
        foreach (MatchEvent e in events)
        {
            Bucket(e.MatchId).Add(e);
        }

        return Task.CompletedTask;
    }

    public Task<IReadOnlyList<MatchEvent>> GetForMatchAsync(Guid matchId, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        IReadOnlyList<MatchEvent> events = Stored(matchId).ToList();
        return Task.FromResult(events);
    }

    public Task<IReadOnlyList<MatchEvent>> GetForSquadCompletedMatchesAsync(Guid squadId, CancellationToken ct) =>
        throw new NotSupportedException("Not exercised by the recording handler under test.");

    private List<MatchEvent> Bucket(Guid matchId)
    {
        if (!_byMatch.TryGetValue(matchId, out List<MatchEvent>? list))
        {
            list = [];
            _byMatch[matchId] = list;
        }

        return list;
    }
}

/// <summary>
/// In-memory <see cref="IMatchRepository"/> serving a single seeded match by identity (or
/// <see langword="null"/> for any other id, exercising the existence-concealment path). The write and
/// listing members are unused by the recording handler and throw if called.
/// </summary>
internal sealed class SingleMatchRepository(Match match) : IMatchRepository
{
    public Task<Match?> GetByIdAsync(Guid matchId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(matchId == match.Id ? match : null);
    }

    public Task AddAsync(Match match, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Recording does not add matches.");

    public Task<IReadOnlyList<Match>> GetForSquadAsync(Guid squadId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Recording does not list matches.");

    public Task<IReadOnlyList<Match>> ListChronologicalCompletedForSquadAsync(Guid squadId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Recording does not list completed matches.");
}

/// <summary>
/// In-memory <see cref="ISquadMembershipRepository"/> resolving the acting membership by backing user
/// and squad — the only operation the recording handler uses. Every other member throws if called.
/// </summary>
internal sealed class ConfiguredMembershipRepository(IReadOnlyList<SquadMembership> memberships) : ISquadMembershipRepository
{
    public Task<SquadMembership?> GetByUserAndSquadAsync(Guid userId, Guid squadId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(memberships.FirstOrDefault(m => m.UserId == userId && m.SquadId == squadId));
    }

    public Task AddAsync(SquadMembership membership, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the recording handler under test.");

    public Task<SquadMembership?> GetByIdAsync(Guid membershipId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the recording handler under test.");

    public Task<IReadOnlyList<SquadMembership>> ListForSquadAsync(Guid squadId, bool activeOnly, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the recording handler under test.");

    public Task<SquadMembership?> GetOwnerAsync(Guid squadId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the recording handler under test.");

    public Task<bool> IsSquadPendingDeletionAsync(Guid squadId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the recording handler under test.");

    public Task<bool> DisplayNameTakenAsync(Guid squadId, string normalisedName, Guid? excludingMembershipId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the recording handler under test.");

    public Task<IReadOnlyList<SquadMembership>> ListForUserAsync(Guid userId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the recording handler under test.");

    public void RemovePermanently(SquadMembership membership) =>
        throw new NotSupportedException("Not exercised by the recording handler under test.");
}

/// <summary>
/// In-memory <see cref="ISquadRepository"/> serving the single seeded squad by identity — read by the
/// recording handler only to gate the <c>LiveMatchTracking</c> flag. Every other member throws.
/// </summary>
internal sealed class SingleSquadRepository(Squad squad) : ISquadRepository
{
    public Task<Squad?> GetByIdAsync(Guid squadId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(squadId == squad.Id ? squad : null);
    }

    public Task AddAsync(Squad squad, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the recording handler under test.");

    public Task<Squad?> GetByIdIncludingDeletedAsync(Guid squadId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the recording handler under test.");

    public Task<IReadOnlyList<Squad>> ListForUserAsync(Guid userId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the recording handler under test.");

    public Task<IReadOnlyList<Squad>> ListPurgeDueAsync(DateTimeOffset now, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the recording handler under test.");

    public void RemovePermanently(Squad squad) =>
        throw new NotSupportedException("Not exercised by the recording handler under test.");
}

/// <summary>A minimal <see cref="IUnitOfWork"/> that commits successfully and counts save attempts.</summary>
internal sealed class CountingUnitOfWork : IUnitOfWork
{
    /// <summary>The number of times <see cref="SaveChangesAsync"/> has been invoked.</summary>
    public int SaveCallCount { get; private set; }

    public Task<int> SaveChangesAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        SaveCallCount++;
        return Task.FromResult(1);
    }
}

/// <summary>A mutable <see cref="ICurrentUserAccessor"/> whose subject a test sets before each request.</summary>
internal sealed class MutableCurrentUserAccessor : ICurrentUserAccessor
{
    /// <inheritdoc />
    public string? CurrentUserId { get; set; }
}
