using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Squads;

namespace PitchMate.Api.Tests.Serialisation;

/// <summary>
/// A membership repository that resolves nothing: every read reports "no such membership" and every
/// write throws. It exists so the wire-contract guard can drive a real squad endpoint end to end —
/// through routing, authentication, body binding, the real use-case handler, and the real
/// <c>SquadErrorResults</c> seam — without a database behind it.
/// <para>
/// The guard's control case needs a response it can attribute. With no membership resolvable, the real
/// <c>SquadAuthorization.RequireOwnerOrAdmin</c> gate rejects the caller uniformly before the handler
/// reads anything else, so the endpoint answers <c>403</c> with the authorisation code rather than
/// reaching for a store the in-memory host has no connection to. Nothing here stands in for the
/// behaviour under test: the rejection of a numeric enum happens during body binding, before this type
/// is ever consulted.
/// </para>
/// </summary>
internal sealed class AbsentMembershipRepository : ISquadMembershipRepository
{
    /// <inheritdoc />
    public Task AddAsync(SquadMembership membership, CancellationToken cancellationToken) =>
        throw new InvalidOperationException(
            "The wire-contract guard must never reach a membership write; a request is answered by binding or the authorisation gate.");

    /// <inheritdoc />
    public void RemovePermanently(SquadMembership membership) =>
        throw new InvalidOperationException(
            "The wire-contract guard must never reach a membership removal; a request is answered by binding or the authorisation gate.");

    /// <inheritdoc />
    public Task<SquadMembership?> GetByIdAsync(Guid membershipId, CancellationToken cancellationToken) =>
        Task.FromResult<SquadMembership?>(null);

    /// <inheritdoc />
    public Task<SquadMembership?> GetByUserAndSquadAsync(Guid userId, Guid squadId, CancellationToken cancellationToken) =>
        Task.FromResult<SquadMembership?>(null);

    /// <inheritdoc />
    public Task<SquadMembership?> GetOwnerAsync(Guid squadId, CancellationToken cancellationToken) =>
        Task.FromResult<SquadMembership?>(null);

    /// <inheritdoc />
    public Task<IReadOnlyList<SquadMembership>> ListForSquadAsync(Guid squadId, bool activeOnly, CancellationToken cancellationToken) =>
        Task.FromResult<IReadOnlyList<SquadMembership>>([]);

    /// <inheritdoc />
    public Task<IReadOnlyList<SquadMembership>> ListForUserAsync(Guid userId, CancellationToken cancellationToken) =>
        Task.FromResult<IReadOnlyList<SquadMembership>>([]);

    /// <inheritdoc />
    public Task<bool> IsSquadPendingDeletionAsync(Guid squadId, CancellationToken cancellationToken) =>
        Task.FromResult(false);

    /// <inheritdoc />
    public Task<bool> DisplayNameTakenAsync(
        Guid squadId,
        string normalisedName,
        Guid? excludingMembershipId,
        CancellationToken cancellationToken) =>
        Task.FromResult(false);
}
