using PitchMate.Application.Squads.UseCases;
using PitchMate.Domain.Squads;

namespace PitchMate.Application.Tests.Squads;

/// <summary>
/// Example/unit tests for <see cref="GetFeatureFlagsHandler"/>: an active member reads every
/// <see cref="SquadFeature"/> member with its current state, including features reported as disabled
/// (Requirement 13.4, 13.5); every requester who is not an active member — inactive membership,
/// non-member, or a member of a soft-deleted squad — is rejected with the uniform authorisation
/// failure disclosing no feature state (Requirement 13.8).
/// </summary>
[Trait("Feature", "squads-and-membership")]
public class GetFeatureFlagsHandlerTests
{
    private sealed class Harness
    {
        public required SquadStore Store { get; init; }
        public required GetFeatureFlagsHandler Handler { get; init; }
        public required Squad Squad { get; init; }

        public static Harness Create(bool softDeleted = false)
        {
            var store = new SquadStore();
            Squad squad = Squad.Create("The Squad").Value!;
            store.AddCommittedSquad(squad, softDeleted);
            // A separate owner so the squad is well-formed.
            store.AddCommittedMembership(
                SquadMembership.CreateOwner(squad.Id, Guid.NewGuid(), "Owner").Value!);

            var handler = new GetFeatureFlagsHandler(
                new FakeSquadRepository(store),
                new FakeSquadMembershipRepository(store));

            return new Harness { Store = store, Handler = handler, Squad = squad };
        }

        public Guid SeedActiveMember()
        {
            Guid userId = Guid.NewGuid();
            Store.AddCommittedMembership(
                SquadMembership.CreateRegistered(Squad.Id, userId, "Member").Value!);
            return userId;
        }

        public Guid SeedInactiveMember()
        {
            Guid userId = Guid.NewGuid();
            SquadMembership membership = SquadMembership.CreateRegistered(Squad.Id, userId, "Ghost").Value!;
            membership.Deactivate();
            Store.AddCommittedMembership(membership);
            return userId;
        }
    }

    [Fact]
    public async Task ActiveMember_ReadsEveryFeatureWithItsCurrentState()
    {
        var harness = Harness.Create();
        Guid member = harness.SeedActiveMember();
        harness.Squad.SetFeature(SquadFeature.LiveMatchTracking, true);

        Result<IReadOnlyList<SquadFeatureView>> result = await harness.Handler.HandleAsync(
            new GetFeatureFlagsCommand(member, harness.Squad.Id), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(Enum.GetValues<SquadFeature>().Length, result.Value!.Count);
        Assert.Contains(result.Value!, f => f.Feature == SquadFeature.LiveMatchTracking && f.IsEnabled);
    }

    [Fact]
    public async Task ActiveMember_ReadsDisabledFeatureAsDisabled()
    {
        var harness = Harness.Create();
        Guid member = harness.SeedActiveMember();

        Result<IReadOnlyList<SquadFeatureView>> result = await harness.Handler.HandleAsync(
            new GetFeatureFlagsCommand(member, harness.Squad.Id), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.All(result.Value!, f => Assert.False(f.IsEnabled));
    }

    [Fact]
    public async Task InactiveMember_IsRejected_WithNoFeatureState()
    {
        var harness = Harness.Create();
        Guid ghost = harness.SeedInactiveMember();

        Result<IReadOnlyList<SquadFeatureView>> result = await harness.Handler.HandleAsync(
            new GetFeatureFlagsCommand(ghost, harness.Squad.Id), CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Null(result.Value);
        Assert.Equal(SquadErrorCode.Unauthorized, result.Error!.Code);
    }

    [Fact]
    public async Task NonMember_IsRejected_WithNoFeatureState()
    {
        var harness = Harness.Create();

        Result<IReadOnlyList<SquadFeatureView>> result = await harness.Handler.HandleAsync(
            new GetFeatureFlagsCommand(Guid.NewGuid(), harness.Squad.Id), CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Null(result.Value);
        Assert.Equal(SquadErrorCode.Unauthorized, result.Error!.Code);
    }

    [Fact]
    public async Task ActiveMemberOfSoftDeletedSquad_IsRejected_RevealingNothing()
    {
        var harness = Harness.Create(softDeleted: true);
        Guid member = harness.SeedActiveMember();

        Result<IReadOnlyList<SquadFeatureView>> result = await harness.Handler.HandleAsync(
            new GetFeatureFlagsCommand(member, harness.Squad.Id), CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Null(result.Value);
        Assert.Equal(SquadErrorCode.Unauthorized, result.Error!.Code);
    }
}
