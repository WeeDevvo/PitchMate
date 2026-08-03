using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Notifications;
using PitchMate.Domain.Matches;
using NotificationType = PitchMate.Domain.Notifications.NotificationType;
using NotifResult = PitchMate.Domain.Notifications.Result;

namespace PitchMate.Application.Tests.Matches;

/// <summary>
/// In-memory <see cref="IMatchRepository"/> that returns a single pre-committed match by identity for
/// the confirmation handler. Unlike draft creation, confirmation reads the aggregate back and mutates
/// it in place, so <see cref="GetByIdAsync"/> hands out the seeded match; the staging/listing members
/// are not exercised by the confirmation handler and throw if called, so a test that accidentally
/// depends on them fails loudly. It is a real fake, not a mocking-framework stub.
/// </summary>
internal sealed class ConfirmFakeMatchRepository : IMatchRepository
{
    private readonly Match? _match;

    public ConfirmFakeMatchRepository(Match? match) => _match = match;

    public Task<Match?> GetByIdAsync(Guid matchId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(_match is not null && _match.Id == matchId ? _match : null);
    }

    public Task AddAsync(Match match, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Confirmation does not add matches.");

    public Task<IReadOnlyList<Match>> GetForSquadAsync(Guid squadId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Confirmation does not list matches.");

    public Task<IReadOnlyList<Match>> ListChronologicalCompletedForSquadAsync(Guid squadId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Confirmation does not list completed matches.");
}

/// <summary>
/// In-memory <see cref="IAvailabilityRepository"/> that returns a fixed set of stored responses for
/// the confirmation handler's available-count computation. Only <see cref="ListResponsesAsync"/> is
/// exercised; the per-membership lookup and the upsert/clear stages are not used during confirmation
/// and throw if called. It is a real fake, not a mocking-framework stub.
/// </summary>
internal sealed class ConfirmFakeAvailabilityRepository : IAvailabilityRepository
{
    private readonly IReadOnlyList<AvailabilityResponse> _responses;

    public ConfirmFakeAvailabilityRepository(IReadOnlyList<AvailabilityResponse> responses) =>
        _responses = responses;

    public Task<IReadOnlyList<AvailabilityResponse>> ListResponsesAsync(Guid matchId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(_responses);
    }

    public Task<AvailabilityResponse?> GetResponseAsync(Guid matchId, Guid squadMembershipId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Confirmation does not read a single response.");

    public Task UpsertAsync(AvailabilityResponse response, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Confirmation does not upsert responses.");

    public Task RemoveAsync(AvailabilityResponse response, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Confirmation does not remove responses.");
}

/// <summary>
/// A fake <see cref="IUnitOfWork"/> that models the confirmation commit boundary. It counts the save
/// attempts so publish ordering can be asserted; constructed with <c>throwOnSave: true</c> it throws
/// to model a mid-operation persistence failure, so the no-publish-on-rollback rule can be asserted
/// (Requirement 6.6).
/// </summary>
internal sealed class ConfirmFakeUnitOfWork : IUnitOfWork
{
    private readonly bool _throwOnSave;

    public ConfirmFakeUnitOfWork(bool throwOnSave = false) => _throwOnSave = throwOnSave;

    /// <summary>The number of times a save was attempted.</summary>
    public int SaveCallCount { get; private set; }

    /// <summary>Whether at least one save has committed successfully.</summary>
    public bool HasCommitted { get; private set; }

    public Task<int> SaveChangesAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        SaveCallCount++;

        if (_throwOnSave)
        {
            throw new InvalidOperationException("Induced save failure for rollback testing.");
        }

        HasCommitted = true;
        return Task.FromResult(1);
    }
}

/// <summary>How the fake publisher behaves when (and if) it is invoked after a committed confirmation.</summary>
internal enum ConfirmPublisherMode
{
    /// <summary>The publish returns a success result.</summary>
    Success,

    /// <summary>The publish returns a failure result (must be isolated and swallowed).</summary>
    FailureResult,

    /// <summary>The publish throws (must be caught and swallowed).</summary>
    Throws,
}

/// <summary>
/// In-memory <see cref="INotificationPublisher"/> that records each publish call so the confirmation
/// tests can assert the notification type and owning squad, and — via
/// <see cref="PublishCall.CommittedAtPublish"/> — that publishing happens only <em>after</em> the
/// confirmation has committed (Requirement 6.6). It can be told to return a failure result or throw,
/// so the producer's best-effort isolation can be exercised. It is a real fake, not a mocking-
/// framework stub.
/// </summary>
internal sealed class CapturingConfirmPublisher : INotificationPublisher
{
    private readonly ConfirmPublisherMode _mode;
    private readonly ConfirmFakeUnitOfWork _unitOfWork;

    public CapturingConfirmPublisher(ConfirmPublisherMode mode, ConfirmFakeUnitOfWork unitOfWork)
    {
        _mode = mode;
        _unitOfWork = unitOfWork;
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

        // Capture whether the confirmation had committed by the time the publisher ran — the
        // post-commit ordering the handler promises (Requirement 6.6).
        Calls.Add(new PublishCall(type, squadId, directedTargetMembershipIds.ToArray(), _unitOfWork.HasCommitted));

        if (_mode == ConfirmPublisherMode.Throws)
        {
            throw new InvalidOperationException("Induced publish failure for isolation testing.");
        }

        NotifResult result = _mode == ConfirmPublisherMode.FailureResult
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
        bool CommittedAtPublish);
}
