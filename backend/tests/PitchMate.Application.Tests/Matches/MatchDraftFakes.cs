using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Notifications;
using PitchMate.Domain.Matches;
using NotificationType = PitchMate.Domain.Notifications.NotificationType;
using NotifResult = PitchMate.Domain.Notifications.Result;

namespace PitchMate.Application.Tests.Matches;

/// <summary>
/// A hand-written, in-memory backing store for the match use-case test doubles. It models the
/// Unit-of-Work boundary faithfully: <see cref="FakeMatchRepository.AddAsync"/> only <em>stages</em> a
/// match, and it becomes committed only when <see cref="Commit"/> runs as part of a successful
/// <see cref="FakeMatchUnitOfWork.SaveChangesAsync"/>; a failing save
/// <see cref="DiscardPending">discards</see> the staged match so nothing is persisted. This is a real
/// fake (list-backed implementation of the Application contract), not a mocking-framework stub and not
/// a database.
/// </summary>
internal sealed class MatchStore
{
    private readonly List<Match> _matches = new();
    private readonly List<Match> _pending = new();

    /// <summary>The matches durably committed so far.</summary>
    public IReadOnlyList<Match> Matches => _matches;

    /// <summary>The number of times a save was attempted against this store.</summary>
    public int SaveCallCount { get; private set; }

    /// <summary>Stages a match for insertion on the next successful save.</summary>
    public void Stage(Match match) => _pending.Add(match);

    /// <summary>Records that a save was attempted.</summary>
    public void RecordSaveCall() => SaveCallCount++;

    /// <summary>Atomically commits every staged match, returning the row count.</summary>
    public int Commit()
    {
        int count = _pending.Count;
        _matches.AddRange(_pending);
        _pending.Clear();
        return count;
    }

    /// <summary>Discards staged matches without committing, modelling a rolled-back save.</summary>
    public void DiscardPending() => _pending.Clear();

    /// <summary>Finds a committed match by identity, or <see langword="null"/>.</summary>
    public Match? FindById(Guid matchId) => _matches.FirstOrDefault(m => m.Id == matchId);

    /// <summary>Whether a match with <paramref name="matchId"/> has been durably committed.</summary>
    public bool IsCommitted(Guid matchId) => _matches.Any(m => m.Id == matchId);
}

/// <summary>
/// In-memory <see cref="IMatchRepository"/> over a <see cref="MatchStore"/>. <c>AddAsync</c> only
/// stages the match (committed on a successful unit-of-work save); the graph/listing lookups are not
/// exercised by the draft-creation handler and throw if called, so a test that accidentally depends
/// on them fails loudly.
/// </summary>
internal sealed class FakeMatchRepository : IMatchRepository
{
    private readonly MatchStore _store;

    public FakeMatchRepository(MatchStore store) => _store = store;

    public Task AddAsync(Match match, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        ArgumentNullException.ThrowIfNull(match);
        _store.Stage(match);
        return Task.CompletedTask;
    }

    public Task<Match?> GetByIdAsync(Guid matchId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Draft creation does not read matches back.");

    public Task<IReadOnlyList<Match>> GetForSquadAsync(Guid squadId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Draft creation does not list matches.");

    public Task<IReadOnlyList<Match>> ListChronologicalCompletedForSquadAsync(Guid squadId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Draft creation does not list completed matches.");
}

/// <summary>
/// A fake <see cref="IUnitOfWork"/> over a <see cref="MatchStore"/>. A normal save atomically commits
/// the staged match; a save constructed with <c>throwOnSave: true</c> discards the staged match and
/// throws, modelling a mid-operation persistence failure so the no-publish-on-rollback rule can be
/// asserted (Requirement 3.2).
/// </summary>
internal sealed class FakeMatchUnitOfWork : IUnitOfWork
{
    private readonly MatchStore _store;
    private readonly bool _throwOnSave;

    public FakeMatchUnitOfWork(MatchStore store, bool throwOnSave = false)
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
            throw new InvalidOperationException("Induced save failure for rollback testing.");
        }

        return Task.FromResult(_store.Commit());
    }
}

/// <summary>How the fake publisher behaves when (and if) it is invoked after a committed match draft.</summary>
internal enum DraftPublisherMode
{
    /// <summary>The publish returns a success result.</summary>
    Success,

    /// <summary>The publish returns a failure result (must be isolated and swallowed).</summary>
    FailureResult,

    /// <summary>The publish throws (must be caught and swallowed).</summary>
    Throws,
}

/// <summary>
/// In-memory <see cref="INotificationPublisher"/> that records each publish call so the draft-wiring
/// tests can assert the notification type and owning squad, and — via
/// <see cref="PublishCall.MatchWasCommittedAtPublish"/> — that publishing happens only <em>after</em>
/// the match has committed (Requirement 3.1). It can be told to return a failure result or throw, so
/// the producer's best-effort isolation can be exercised (Requirement 3.3). It is a real fake, not a
/// mocking-framework stub.
/// </summary>
internal sealed class CapturingDraftPublisher : INotificationPublisher
{
    private readonly DraftPublisherMode _mode;
    private readonly MatchStore _store;

    public CapturingDraftPublisher(DraftPublisherMode mode, MatchStore store)
    {
        _mode = mode;
        _store = store;
    }

    /// <summary>The publish calls captured in invocation order.</summary>
    public List<PublishCall> Calls { get; } = new();

    public Task<NotifResult> PublishAsync(
        NotificationType type,
        Guid squadId,
        IReadOnlyCollection<Guid> directedTargetMembershipIds,
        NotificationContext context,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        // Every committed match is durable by the time the publisher runs, so record whether the
        // publish observed at least one committed match — the post-commit ordering the handler promises.
        bool committed = _store.Matches.Count > 0;
        Calls.Add(new PublishCall(type, squadId, directedTargetMembershipIds.ToArray(), committed));

        if (_mode == DraftPublisherMode.Throws)
        {
            throw new InvalidOperationException("Induced publish failure for isolation testing.");
        }

        NotifResult result = _mode == DraftPublisherMode.FailureResult
            ? NotifResult.Fail(new PitchMate.Domain.Notifications.NotificationError(
                PitchMate.Domain.Notifications.NotificationErrorCode.PublishFailed,
                "Induced failure result for isolation testing."))
            : NotifResult.Ok();

        return Task.FromResult(result);
    }

    /// <summary>A single captured publish invocation.</summary>
    internal sealed record PublishCall(
        NotificationType Type,
        Guid SquadId,
        IReadOnlyList<Guid> DirectedTargetMembershipIds,
        bool MatchWasCommittedAtPublish);
}
