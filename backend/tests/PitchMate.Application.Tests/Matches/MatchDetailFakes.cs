using PitchMate.Application.Matches.Abstractions;
using PitchMate.Domain.Matches;

namespace PitchMate.Application.Tests.Matches;

/// <summary>
/// A detail source that answers every lookup with one fixed projection (or <see langword="null"/>) and
/// records the match identities it was asked for.
/// </summary>
internal sealed class RecordingMatchDetailSource(MatchDetailProjection? projection) : IMatchDetailSource
{
    private readonly List<Guid> _calls = [];

    public IReadOnlyList<Guid> Calls => _calls;

    public Task<MatchDetailProjection?> FindAsync(Guid matchId, CancellationToken cancellationToken)
    {
        _calls.Add(matchId);
        return Task.FromResult(projection);
    }
}

/// <summary>
/// An availability gateway holding stored responses keyed by match and membership, recording every
/// single-response lookup so a test can assert whose response the handler read.
/// </summary>
internal sealed class StoredResponseAvailabilityRepository(params AvailabilityResponse[] responses) : IAvailabilityRepository
{
    private readonly List<(Guid MatchId, Guid MembershipId)> _lookups = [];

    public IReadOnlyList<(Guid MatchId, Guid MembershipId)> Lookups => _lookups;

    public Task<AvailabilityResponse?> GetResponseAsync(Guid matchId, Guid squadMembershipId, CancellationToken cancellationToken)
    {
        _lookups.Add((matchId, squadMembershipId));
        return Task.FromResult(responses.FirstOrDefault(response =>
            response.MatchId == matchId && response.SquadMembershipId == squadMembershipId));
    }

    public Task UpsertAsync(AvailabilityResponse response, CancellationToken cancellationToken) =>
        throw new NotSupportedException("The detail read writes nothing.");

    public Task RemoveAsync(AvailabilityResponse response, CancellationToken cancellationToken) =>
        throw new NotSupportedException("The detail read writes nothing.");

    public Task<IReadOnlyList<AvailabilityResponse>> ListResponsesAsync(Guid matchId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("The detail read reports the caller's response alone, never the squad's.");
}
