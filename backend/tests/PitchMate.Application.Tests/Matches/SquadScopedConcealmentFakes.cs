using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Matches;
using PitchMate.Domain.Squads;

namespace PitchMate.Application.Tests.Matches;

/// <summary>
/// Minimal in-memory <see cref="IMatchRepository"/> for the squad-scoped concealment test: holds a
/// single match and returns it by identity, or <see langword="null"/> for any other id so a request
/// for a non-existent match takes the same non-disclosing path as an unauthorised actor. The write
/// and listing members are unused by the read handlers under test and throw if called.
/// </summary>
internal sealed class ConcealmentMatchRepository(Match match) : IMatchRepository
{
    private readonly Match _match = match;

    public Task<Match?> GetByIdAsync(Guid matchId, CancellationToken cancellationToken) =>
        Task.FromResult(matchId == _match.Id ? _match : null);

    public Task AddAsync(Match match, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the read handlers under test.");

    public Task<IReadOnlyList<Match>> GetForSquadAsync(Guid squadId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the read handlers under test.");

    public Task<IReadOnlyList<Match>> ListChronologicalCompletedForSquadAsync(Guid squadId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the read handlers under test.");
}

/// <summary>
/// Minimal in-memory <see cref="IAvailabilityRepository"/> for the concealment test. The tally handler
/// computes over the responses returned by <see cref="ListResponsesAsync"/>; the concealment property
/// cares only about who is admitted, so this fake returns the (optionally seeded) responses and an
/// empty set still yields a valid tally success for an authorised member. The mutating members are
/// unused by the read handlers under test and throw if called.
/// </summary>
internal sealed class ConcealmentAvailabilityRepository(params AvailabilityResponse[] responses) : IAvailabilityRepository
{
    private readonly IReadOnlyList<AvailabilityResponse> _responses = responses;

    public Task<IReadOnlyList<AvailabilityResponse>> ListResponsesAsync(Guid matchId, CancellationToken cancellationToken) =>
        Task.FromResult(_responses);

    public Task<AvailabilityResponse?> GetResponseAsync(Guid matchId, Guid squadMembershipId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the read handlers under test.");

    public Task UpsertAsync(AvailabilityResponse response, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the read handlers under test.");

    public Task RemoveAsync(AvailabilityResponse response, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the read handlers under test.");
}

/// <summary>
/// Minimal in-memory <see cref="ISquadMembershipRepository"/> for the concealment test. It resolves an
/// acting membership by backing user and squad from a fixed set of memberships, returning
/// <see langword="null"/> when the user holds no membership in the squad — the resolution the read
/// handlers gate on. Every other member is unused by the read handlers under test and throws if
/// called.
/// </summary>
internal sealed class ConcealmentMembershipRepository(params SquadMembership[] memberships) : ISquadMembershipRepository
{
    private readonly IReadOnlyList<SquadMembership> _memberships = memberships;

    public Task<SquadMembership?> GetByUserAndSquadAsync(Guid userId, Guid squadId, CancellationToken cancellationToken) =>
        Task.FromResult(_memberships.FirstOrDefault(m => m.UserId == userId && m.SquadId == squadId));

    public Task AddAsync(SquadMembership membership, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the read handlers under test.");

    public Task<SquadMembership?> GetByIdAsync(Guid membershipId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the read handlers under test.");

    public Task<IReadOnlyList<SquadMembership>> ListForSquadAsync(Guid squadId, bool activeOnly, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the read handlers under test.");

    public Task<SquadMembership?> GetOwnerAsync(Guid squadId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the read handlers under test.");

    public Task<bool> IsSquadPendingDeletionAsync(Guid squadId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the read handlers under test.");

    public Task<bool> DisplayNameTakenAsync(Guid squadId, string normalisedName, Guid? excludingMembershipId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the read handlers under test.");

    public Task<IReadOnlyList<SquadMembership>> ListForUserAsync(Guid userId, CancellationToken cancellationToken) =>
        throw new NotSupportedException("Not exercised by the read handlers under test.");

    public void RemovePermanently(SquadMembership membership) =>
        throw new NotSupportedException("Not exercised by the read handlers under test.");
}
