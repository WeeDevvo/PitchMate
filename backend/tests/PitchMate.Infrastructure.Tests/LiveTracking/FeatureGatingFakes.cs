using PitchMate.Application.Common;
using PitchMate.Application.Common.Persistence;
using PitchMate.Application.LiveTracking;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.LiveTracking;
using Match = PitchMate.Domain.Matches.Match;
using Squad = PitchMate.Domain.Squads.Squad;
using SquadMembership = PitchMate.Domain.Squads.SquadMembership;

namespace PitchMate.Infrastructure.Tests.LiveTracking;

/// <summary>
/// An append-only, in-memory <see cref="IMatchEventRepository"/> holding a flat event log. It serves
/// both the <c>EventLogRichStatsSource</c> read path
/// (<see cref="GetForSquadCompletedMatchesAsync"/> returns the squad's events, standing in for the
/// completed-matches join) and the <c>RecordEventBatchHandler</c> path
/// (<see cref="GetExistingEventIdsAsync"/>, <see cref="GetForMatchAsync"/>, <see cref="AppendAsync"/>),
/// so the feature-gating property can drive both components. <see cref="AppendAsync"/> only ever adds
/// rows and counts them, so a test can assert nothing was appended. It is a real fake, not a mock.
/// </summary>
internal sealed class FakeMatchEventRepository : IMatchEventRepository
{
    private readonly List<MatchEvent> _events;

    /// <summary>Creates the repository seeded with <paramref name="seed"/> (or empty when omitted).</summary>
    public FakeMatchEventRepository(IEnumerable<MatchEvent>? seed = null) =>
        _events = seed?.ToList() ?? [];

    /// <summary>The total number of stored events, used to assert nothing was appended.</summary>
    public int TotalCount => _events.Count;

    /// <summary>The number of events appended through <see cref="AppendAsync"/>.</summary>
    public int AppendedCount { get; private set; }

    public Task<IReadOnlySet<Guid>> GetExistingEventIdsAsync(Guid matchId, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        IReadOnlySet<Guid> ids = _events.Where(e => e.MatchId == matchId).Select(e => e.Id).ToHashSet();
        return Task.FromResult(ids);
    }

    public Task AppendAsync(IReadOnlyList<MatchEvent> events, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        ArgumentNullException.ThrowIfNull(events);
        AppendedCount += events.Count;
        _events.AddRange(events);
        return Task.CompletedTask;
    }

    public Task<IReadOnlyList<MatchEvent>> GetForMatchAsync(Guid matchId, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        IReadOnlyList<MatchEvent> list = _events.Where(e => e.MatchId == matchId).ToList();
        return Task.FromResult(list);
    }

    public Task<IReadOnlyList<MatchEvent>> GetForSquadCompletedMatchesAsync(Guid squadId, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        IReadOnlyList<MatchEvent> list = _events.Where(e => e.SquadId == squadId).ToList();
        return Task.FromResult(list);
    }
}

/// <summary>
/// In-memory <see cref="ISquadRepository"/> serving a single squad for a chosen squad identity. The
/// squad's own <c>Id</c> is immaterial (it is generated) — the rich-stats source only reads its
/// feature flag — so the repository keys on the supplied <paramref name="squadId"/> the source queries
/// with. Every other member throws if called.
/// </summary>
internal sealed class FakeSquadRepository(Guid squadId, Squad squad) : ISquadRepository
{
    public Task<Squad?> GetByIdAsync(Guid id, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(id == squadId ? squad : null);
    }

    public Task AddAsync(Squad squad, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the feature-gating property under test.");

    public Task<Squad?> GetByIdIncludingDeletedAsync(Guid squadId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the feature-gating property under test.");

    public Task<IReadOnlyList<Squad>> ListForUserAsync(Guid userId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the feature-gating property under test.");

    public Task<IReadOnlyList<Squad>> ListPurgeDueAsync(DateTimeOffset now, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the feature-gating property under test.");

    public void RemovePermanently(Squad squad) =>
        throw new NotSupportedException("Not exercised by the feature-gating property under test.");
}

/// <summary>In-memory <see cref="IMatchRepository"/> serving a single seeded match by identity.</summary>
internal sealed class SingleMatchRepository(Match match) : IMatchRepository
{
    public Task<Match?> GetByIdAsync(Guid matchId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(matchId == match.Id ? match : null);
    }

    public Task AddAsync(Match match, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the feature-gating property under test.");

    public Task<IReadOnlyList<Match>> GetForSquadAsync(Guid squadId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the feature-gating property under test.");

    public Task<IReadOnlyList<Match>> ListChronologicalCompletedForSquadAsync(Guid squadId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the feature-gating property under test.");
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
        throw new NotSupportedException("Not exercised by the feature-gating property under test.");

    public Task<SquadMembership?> GetByIdAsync(Guid membershipId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the feature-gating property under test.");

    public Task<IReadOnlyList<SquadMembership>> ListForSquadAsync(Guid squadId, bool activeOnly, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the feature-gating property under test.");

    public Task<SquadMembership?> GetOwnerAsync(Guid squadId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the feature-gating property under test.");

    public Task<bool> IsSquadPendingDeletionAsync(Guid squadId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the feature-gating property under test.");

    public Task<bool> DisplayNameTakenAsync(Guid squadId, string normalisedName, Guid? excludingMembershipId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the feature-gating property under test.");

    public Task<IReadOnlyList<SquadMembership>> ListForUserAsync(Guid userId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the feature-gating property under test.");

    public void RemovePermanently(SquadMembership membership) =>
        throw new NotSupportedException("Not exercised by the feature-gating property under test.");
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

/// <summary>A fixed <see cref="ICurrentUserAccessor"/> whose subject is the acting user's id.</summary>
internal sealed class FixedCurrentUserAccessor(Guid userId) : ICurrentUserAccessor
{
    /// <inheritdoc />
    public string? CurrentUserId { get; } = userId.ToString();
}
