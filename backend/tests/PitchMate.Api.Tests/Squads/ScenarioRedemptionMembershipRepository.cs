using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Squads;

namespace PitchMate.Api.Tests.Squads;

/// <summary>
/// An <see cref="ISquadMembershipRepository"/> stand-in that answers the reads an invite redemption
/// performs, from whichever <see cref="InviteRedemptionScenario"/> the test has currently set.
/// <para>
/// It is a separate stand-in from <see cref="ScenarioMembershipRepository"/> rather than a widening of
/// it: that one deliberately throws on every member outside the two guest-claim paths, and relaxing it
/// to serve redemption too would blunt the guard it provides there. The membership surface a redemption
/// touches is a different set of reads.
/// </para>
/// <para>
/// Three reads matter. <see cref="GetByUserAndSquadAsync"/> is the one the outcome turns on: it reports
/// the membership the redeeming user already holds, which decides between confirming an existing
/// membership, reactivating an inactive one, and creating a new one. The squad is never pending deletion,
/// so that pre-emption never takes the situation out from under the guard. And no display name is ever
/// taken, which is the honest answer for a squad whose only memberships are the ones the scenario
/// carries — so a name collision never stands in for the outcome under test.
/// </para>
/// <para>
/// Writes are recorded rather than persisted, so the non-vacuity control can show that a fresh join
/// really staged a membership. Every remaining member throws: reaching one would mean the guard is
/// driving something other than the redemption path under test.
/// </para>
/// </summary>
internal sealed class ScenarioRedemptionMembershipRepository : ISquadMembershipRepository
{
    private readonly List<SquadMembership> _added = [];

    /// <summary>The situation the reads answer from. Set by the test before each request.</summary>
    public InviteRedemptionScenario? Scenario { get; set; }

    /// <summary>The memberships a redemption staged, in the order it staged them.</summary>
    public IReadOnlyList<SquadMembership> Added => _added;

    /// <summary>Forgets the staged memberships, so one request's writes are not read as another's.</summary>
    public void ForgetStagedMemberships() => _added.Clear();

    /// <inheritdoc />
    public Task<SquadMembership?> GetByUserAndSquadAsync(Guid userId, Guid squadId, CancellationToken cancellationToken)
    {
        InviteRedemptionScenario scenario = Require();

        bool isScenarioCaller = squadId == scenario.SquadId && userId == scenario.ActingUserId;
        return Task.FromResult(isScenarioCaller ? scenario.ExistingMembership : null);
    }

    /// <inheritdoc />
    public Task<bool> IsSquadPendingDeletionAsync(Guid squadId, CancellationToken cancellationToken) =>
        Task.FromResult(false);

    /// <inheritdoc />
    public Task<bool> DisplayNameTakenAsync(
        Guid squadId, string normalisedName, Guid? excludingMembershipId, CancellationToken cancellationToken) =>
        Task.FromResult(false);

    /// <inheritdoc />
    public Task AddAsync(SquadMembership membership, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(membership);

        _added.Add(membership);
        return Task.CompletedTask;
    }

    /// <summary>
    /// The squad's memberships, as the post-join notification step reads them: whatever the scenario
    /// carries plus whatever this request staged, filtered as asked. A joiner is a plain member and is
    /// excluded from its own notification, so this resolves to no recipient in every situation the guard
    /// drives — the publish is never the thing under test.
    /// </summary>
    public Task<IReadOnlyList<SquadMembership>> ListForSquadAsync(
        Guid squadId, bool activeOnly, CancellationToken cancellationToken)
    {
        InviteRedemptionScenario scenario = Require();

        if (squadId != scenario.SquadId)
        {
            return Task.FromResult<IReadOnlyList<SquadMembership>>([]);
        }

        IEnumerable<SquadMembership> all = scenario.ExistingMembership is { } existing
            ? _added.Append(existing)
            : _added;

        return Task.FromResult<IReadOnlyList<SquadMembership>>(
            all.Where(m => !activeOnly || m.State == MembershipState.Active).ToList());
    }

    // --- Every other member is outside the surface this guard drives. ---

    /// <inheritdoc />
    public Task<SquadMembership?> GetByIdAsync(Guid membershipId, CancellationToken cancellationToken) =>
        throw Unsupported();

    /// <inheritdoc />
    public Task<SquadMembership?> GetOwnerAsync(Guid squadId, CancellationToken cancellationToken) =>
        throw Unsupported();

    /// <inheritdoc />
    public Task<IReadOnlyList<SquadMembership>> ListForUserAsync(Guid userId, CancellationToken cancellationToken) =>
        throw Unsupported();

    /// <inheritdoc />
    public void RemovePermanently(SquadMembership membership) => throw Unsupported();

    private InviteRedemptionScenario Require() =>
        Scenario ?? throw new InvalidOperationException(
            "No redemption scenario is configured; the redemption guard sets one before each request.");

    private static NotSupportedException Unsupported() => new(
        "This membership repository stand-in supports only the reads an invite redemption performs.");
}
