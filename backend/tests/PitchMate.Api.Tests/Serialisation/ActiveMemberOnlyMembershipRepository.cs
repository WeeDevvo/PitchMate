using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Squads;

namespace PitchMate.Api.Tests.Serialisation;

/// <summary>
/// A read-only <see cref="ISquadMembershipRepository"/> stand-in that resolves exactly one
/// (user, squad) pair to an <see cref="MembershipState.Active"/> owner membership and every other pair
/// to <see langword="null"/>.
/// <para>
/// It exists so the leaderboard query-binding test can drive the real stats endpoint through the real
/// host without a database. That matters for more than convenience: <c>GetLeaderboardHandler</c> runs
/// its active-member gate <em>before</em> it inspects the requested statistic, and the stats seam
/// conceals an authorisation failure as a <c>404</c>. Without a membership that resolves, every request
/// would answer the same concealed <c>404</c> and a binding assertion would be reading concealment
/// rather than binding.
/// </para>
/// </summary>
internal sealed class ActiveMemberOnlyMembershipRepository : ISquadMembershipRepository
{
    private readonly Guid _userId;
    private readonly Guid _squadId;
    private readonly SquadMembership _membership;

    /// <summary>Creates the stand-in for the one (user, squad) pair that resolves to an active member.</summary>
    /// <param name="userId">The backing user whose membership resolves.</param>
    /// <param name="squadId">The squad the membership belongs to.</param>
    public ActiveMemberOnlyMembershipRepository(Guid userId, Guid squadId)
    {
        _userId = userId;
        _squadId = squadId;
        _membership = SquadMembership.CreateOwner(squadId, userId, "Binding Test Owner").Value!;
    }

    /// <inheritdoc />
    public Task<SquadMembership?> GetByUserAndSquadAsync(Guid userId, Guid squadId, CancellationToken cancellationToken) =>
        Task.FromResult(userId == _userId && squadId == _squadId ? _membership : null);

    // --- Every other member is outside the surface this test drives. ---

    /// <inheritdoc />
    public Task AddAsync(SquadMembership membership, CancellationToken cancellationToken) => throw Unsupported();

    /// <inheritdoc />
    public Task<SquadMembership?> GetByIdAsync(Guid membershipId, CancellationToken cancellationToken) => throw Unsupported();

    /// <inheritdoc />
    public Task<IReadOnlyList<SquadMembership>> ListForSquadAsync(Guid squadId, bool activeOnly, CancellationToken cancellationToken) =>
        throw Unsupported();

    /// <inheritdoc />
    public Task<SquadMembership?> GetOwnerAsync(Guid squadId, CancellationToken cancellationToken) => throw Unsupported();

    /// <inheritdoc />
    public Task<bool> IsSquadPendingDeletionAsync(Guid squadId, CancellationToken cancellationToken) => throw Unsupported();

    /// <inheritdoc />
    public Task<bool> DisplayNameTakenAsync(
        Guid squadId, string normalisedName, Guid? excludingMembershipId, CancellationToken cancellationToken) =>
        throw Unsupported();

    /// <inheritdoc />
    public Task<IReadOnlyList<SquadMembership>> ListForUserAsync(Guid userId, CancellationToken cancellationToken) =>
        throw Unsupported();

    /// <inheritdoc />
    public void RemovePermanently(SquadMembership membership) => throw Unsupported();

    private static NotSupportedException Unsupported() => new(
        "This membership repository stand-in supports only GetByUserAndSquadAsync; "
            + "the leaderboard query-binding test drives no other membership operation.");
}
