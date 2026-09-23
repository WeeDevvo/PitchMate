using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Squads;

namespace PitchMate.Api.Tests.Squads;

/// <summary>
/// An <see cref="IGuestClaimRepository"/> stand-in that resolves the open claim of whichever
/// <see cref="GuestClaimScenario"/> the test has currently set, and records the claims an initiation
/// stages so the guard's control case can confirm a claim really was opened rather than merely not
/// rejected.
/// </summary>
internal sealed class ScenarioGuestClaimRepository : IGuestClaimRepository
{
    private readonly List<GuestClaim> _added = new();

    /// <summary>The situation the open-claim read answers from. Set by the test before each request.</summary>
    public GuestClaimScenario? Scenario { get; set; }

    /// <summary>The claims an initiation has staged since <see cref="ForgetStagedClaims"/> was last called.</summary>
    public IReadOnlyList<GuestClaim> StagedClaims => _added;

    /// <summary>Clears the staged-claim record, so one request's staging is read in isolation.</summary>
    public void ForgetStagedClaims() => _added.Clear();

    /// <inheritdoc />
    public Task AddAsync(GuestClaim claim, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(claim);

        _added.Add(claim);
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task<GuestClaim?> GetOpenForMembershipAsync(Guid membershipId, CancellationToken cancellationToken)
    {
        GuestClaimScenario scenario = Scenario ?? throw new InvalidOperationException(
            "No guest-claim scenario is configured; the already-member guard sets one before each request.");

        return Task.FromResult(membershipId == scenario.MembershipId ? scenario.OpenClaim : null);
    }
}
