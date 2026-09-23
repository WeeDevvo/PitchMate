using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Squads;

namespace PitchMate.Api.Tests.Squads;

/// <summary>
/// An <see cref="IInviteRepository"/> stand-in that answers the single read an invite redemption
/// performs, from whichever <see cref="InviteRedemptionScenario"/> the test has currently set: resolving
/// an invite by the one-way hash of the presented secret.
/// <para>
/// The match is a plain ordinal comparison against the hash the scenario's invite actually stores, and
/// the scenario builds that hash with the host's real <see cref="IInviteSecretService"/>. So the
/// handler's hash-and-match step runs for real: a secret that does not hash to the stored value resolves
/// to no invite here, exactly as it would in the database.
/// </para>
/// <para>
/// Every other member throws: reaching one would mean the guard is driving something other than the
/// redemption path under test, and a loud failure is better than a quiet one.
/// </para>
/// </summary>
internal sealed class ScenarioInviteRepository : IInviteRepository
{
    /// <summary>The situation the read answers from. Set by the test before each request.</summary>
    public InviteRedemptionScenario? Scenario { get; set; }

    /// <inheritdoc />
    public Task<Invite?> FindByTokenHashAsync(string tokenHash, CancellationToken cancellationToken)
    {
        InviteRedemptionScenario scenario = Require();

        bool matches = string.Equals(tokenHash, scenario.Invite.TokenHash, StringComparison.Ordinal);
        return Task.FromResult(matches ? scenario.Invite : null);
    }

    // --- Every other member is outside the surface this guard drives. ---

    /// <inheritdoc />
    public Task AddAsync(Invite invite, CancellationToken cancellationToken) => throw Unsupported();

    /// <inheritdoc />
    public Task<Invite?> GetByIdAsync(Guid inviteId, CancellationToken cancellationToken) => throw Unsupported();

    /// <inheritdoc />
    public Task<IReadOnlyList<Invite>> ListForSquadAsync(Guid squadId, CancellationToken cancellationToken) =>
        throw Unsupported();

    /// <inheritdoc />
    public Task<int> CountActiveAsync(Guid squadId, CancellationToken cancellationToken) => throw Unsupported();

    private InviteRedemptionScenario Require() =>
        Scenario ?? throw new InvalidOperationException(
            "No redemption scenario is configured; the redemption guard sets one before each request.");

    private static NotSupportedException Unsupported() => new(
        "This invite repository stand-in supports only the token-hash read an invite redemption performs.");
}
