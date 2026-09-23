using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Squads;

namespace PitchMate.Api.Tests.Squads;

/// <summary>
/// An <see cref="ISquadMembershipRepository"/> stand-in that answers the three reads a guest-claim
/// initiation or completion performs, from whichever <see cref="GuestClaimScenario"/> the test has
/// currently set: the acting caller's membership, the claim target's membership, and — the read the
/// already-member decision turns on — the membership the target user already holds in the squad.
/// <para>
/// Resolution is acting-first, so a scenario in which an admin claims onto <i>themselves</i> resolves
/// that one user to their own membership for both reads, which is exactly what a real repository would
/// do. The by-id read answers only for the membership identity the route carries, so a scenario with no
/// target membership reproduces an unresolvable route parameter rather than a stub artefact.
/// </para>
/// <para>
/// Every other member throws: reaching one would mean the guard is driving something other than the two
/// guest-claim paths under test, and a loud failure is better than a quiet one.
/// </para>
/// </summary>
internal sealed class ScenarioMembershipRepository : ISquadMembershipRepository
{
    /// <summary>The situation the reads answer from. Set by the test before each request.</summary>
    public GuestClaimScenario? Scenario { get; set; }

    /// <inheritdoc />
    public Task<SquadMembership?> GetByUserAndSquadAsync(Guid userId, Guid squadId, CancellationToken cancellationToken)
    {
        GuestClaimScenario scenario = Require();

        if (squadId != scenario.SquadId)
        {
            return Task.FromResult<SquadMembership?>(null);
        }

        if (userId == scenario.ActingUserId)
        {
            return Task.FromResult<SquadMembership?>(scenario.Acting);
        }

        return Task.FromResult(userId == scenario.TargetUserId ? scenario.ExistingTargetMembership : null);
    }

    /// <inheritdoc />
    public Task<SquadMembership?> GetByIdAsync(Guid membershipId, CancellationToken cancellationToken)
    {
        GuestClaimScenario scenario = Require();

        return Task.FromResult(membershipId == scenario.MembershipId ? scenario.TargetMembership : null);
    }

    // --- Every other member is outside the surface this guard drives. ---

    /// <inheritdoc />
    public Task AddAsync(SquadMembership membership, CancellationToken cancellationToken) => throw Unsupported();

    /// <inheritdoc />
    public Task<IReadOnlyList<SquadMembership>> ListForSquadAsync(
        Guid squadId, bool activeOnly, CancellationToken cancellationToken) => throw Unsupported();

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

    private GuestClaimScenario Require() =>
        Scenario ?? throw new InvalidOperationException(
            "No guest-claim scenario is configured; the already-member guard sets one before each request.");

    private static NotSupportedException Unsupported() => new(
        "This membership repository stand-in supports only the reads a guest-claim initiation or "
            + "completion performs.");
}
