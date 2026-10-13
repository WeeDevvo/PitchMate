using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Domain.Matches;

namespace PitchMate.Application.Tests.Matches;

/// <summary>
/// In-memory <see cref="IAvailabilityRepository"/> modelling the Unit-of-Work boundary for the submit
/// path: an upsert only <em>stages</em> a response, which becomes committed on a successful save.
/// Committed responses are keyed by membership, so a replacing submission overwrites the replaced one
/// and the membership is shown to retain at most one stored response. The read and remove members are
/// unused by the submit handler and throw if called.
/// <para>
/// Shared by <see cref="SubmitAvailabilityResponseHandlerTests"/> and
/// <see cref="ReplacedAvailabilityResponsePropertyTests"/> so the example-level and property-level
/// claims about the submission contract observe the same store rather than two parallel fakes.
/// </para>
/// </summary>
internal sealed class RecordingAvailabilityRepository : IAvailabilityRepository
{
    private readonly Dictionary<Guid, AvailabilityResponse> _committed = new();
    private AvailabilityResponse? _staged;

    /// <summary>The number of committed responses stored.</summary>
    public int StoredResponseCount => _committed.Count;

    public Task UpsertAsync(AvailabilityResponse response, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        ArgumentNullException.ThrowIfNull(response);
        _staged = response;
        return Task.CompletedTask;
    }

    /// <summary>Atomically commits the staged response, mirroring a successful unit-of-work save.</summary>
    public void Commit()
    {
        if (_staged is not null)
        {
            _committed[_staged.SquadMembershipId] = _staged;
            _staged = null;
        }
    }

    public Task<AvailabilityResponse?> GetResponseAsync(Guid matchId, Guid squadMembershipId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Submitting does not read a single response back.");

    public Task RemoveAsync(AvailabilityResponse response, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Submitting does not remove responses.");

    public Task<IReadOnlyList<AvailabilityResponse>> ListResponsesAsync(Guid matchId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Submitting does not list responses.");
}

/// <summary>
/// A fake <see cref="IUnitOfWork"/> that commits the staged availability response on save, so a
/// submission the handler completed is observable as committed and one it refused is not.
/// </summary>
internal sealed class CommittingUnitOfWork(RecordingAvailabilityRepository availability) : IUnitOfWork
{
    public Task<int> SaveChangesAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        availability.Commit();
        return Task.FromResult(1);
    }
}
