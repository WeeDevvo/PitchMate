using PitchMate.Application.Squads.UseCases;
using PitchMate.Domain.Squads;

namespace PitchMate.Application.Tests.Squads;

/// <summary>
/// Example/unit tests for <see cref="SetFeatureFlagHandler"/>: an active owner or admin toggles a
/// single feature (Requirement 13.2), an undefined feature value is rejected as a validation failure
/// leaving all states unchanged (Requirement 13.6), and every non-owner/admin actor is rejected with
/// the uniform authorisation failure without changing any feature state (Requirement 13.7). The
/// isolation invariant across all features is covered as a named property by task 12.x.
/// </summary>
[Trait("Feature", "squads-and-membership")]
public class SetFeatureFlagHandlerTests
{
    private sealed class Harness
    {
        public required SquadStore Store { get; init; }
        public required SetFeatureFlagHandler Handler { get; init; }
        public required Guid SquadId { get; init; }

        public static Harness Create(bool throwOnSave = false)
        {
            var store = new SquadStore();
            Squad squad = Squad.Create("The Squad").Value!;
            store.AddCommittedSquad(squad);

            var handler = new SetFeatureFlagHandler(
                new FakeSquadRepository(store),
                new FakeSquadMembershipRepository(store),
                new FakeSquadUnitOfWork(store, throwOnSave));

            return new Harness { Store = store, Handler = handler, SquadId = squad.Id };
        }

        public Guid SeedOwner()
        {
            Guid userId = Guid.NewGuid();
            Store.AddCommittedMembership(
                SquadMembership.CreateOwner(SquadId, userId, "Owner").Value!);
            return userId;
        }

        public Guid SeedAdmin()
        {
            Guid userId = Guid.NewGuid();
            SquadMembership admin = SquadMembership.CreateRegistered(SquadId, userId, "Admin").Value!;
            admin.PromoteToAdmin();
            Store.AddCommittedMembership(admin);
            return userId;
        }

        public Guid SeedMember()
        {
            Guid userId = Guid.NewGuid();
            Store.AddCommittedMembership(
                SquadMembership.CreateRegistered(SquadId, userId, "Member").Value!);
            return userId;
        }

        public Guid SeedInactiveOwner()
        {
            Guid userId = Guid.NewGuid();
            SquadMembership owner = SquadMembership.CreateOwner(SquadId, userId, "GhostOwner").Value!;
            owner.Deactivate();
            Store.AddCommittedMembership(owner);
            return userId;
        }
    }

    [Fact]
    public async Task Owner_EnablingFeature_Succeeds_AndFlagIsSet()
    {
        var harness = Harness.Create();
        Guid owner = harness.SeedOwner();

        Result result = await harness.Handler.HandleAsync(
            new SetFeatureFlagCommand(owner, harness.SquadId, SquadFeature.LiveMatchTracking, true),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.True(harness.Store.Squads[harness.SquadId].IsFeatureEnabled(SquadFeature.LiveMatchTracking));
        Assert.Equal(1, harness.Store.SaveCallCount);
    }

    [Fact]
    public async Task Admin_DisablingPreviouslyEnabledFeature_Succeeds()
    {
        var harness = Harness.Create();
        Guid admin = harness.SeedAdmin();
        harness.Store.Squads[harness.SquadId].SetFeature(SquadFeature.LiveMatchTracking, true);

        Result result = await harness.Handler.HandleAsync(
            new SetFeatureFlagCommand(admin, harness.SquadId, SquadFeature.LiveMatchTracking, false),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.False(harness.Store.Squads[harness.SquadId].IsFeatureEnabled(SquadFeature.LiveMatchTracking));
    }

    [Fact]
    public async Task SettingOneFeature_LeavesAllOtherFeatureStatesUnchanged()
    {
        var harness = Harness.Create();
        Guid owner = harness.SeedOwner();
        Squad squad = harness.Store.Squads[harness.SquadId];

        // Snapshot every non-targeted feature's state before the change.
        var before = Enum.GetValues<SquadFeature>()
            .Where(f => f != SquadFeature.LiveMatchTracking)
            .ToDictionary(f => f, squad.IsFeatureEnabled);

        Result result = await harness.Handler.HandleAsync(
            new SetFeatureFlagCommand(owner, harness.SquadId, SquadFeature.LiveMatchTracking, true),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        foreach ((SquadFeature feature, bool state) in before)
        {
            Assert.Equal(state, squad.IsFeatureEnabled(feature));
        }
    }

    [Fact]
    public async Task UndefinedFeatureValue_IsRejectedAsValidationFailure_AndNothingChanges()
    {
        var harness = Harness.Create();
        Guid owner = harness.SeedOwner();
        var undefined = (SquadFeature)9999;

        Result result = await harness.Handler.HandleAsync(
            new SetFeatureFlagCommand(owner, harness.SquadId, undefined, true),
            CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Equal(SquadErrorCode.ValidationFailed, result.Error!.Code);
        // No feature was enabled and no save was attempted.
        Assert.False(harness.Store.Squads[harness.SquadId].IsFeatureEnabled(SquadFeature.LiveMatchTracking));
        Assert.Equal(0, harness.Store.SaveCallCount);
    }

    [Fact]
    public async Task Member_IsRejected_AndNoFeatureStateChanges()
    {
        var harness = Harness.Create();
        Guid member = harness.SeedMember();

        Result result = await harness.Handler.HandleAsync(
            new SetFeatureFlagCommand(member, harness.SquadId, SquadFeature.LiveMatchTracking, true),
            CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Equal(SquadErrorCode.Unauthorized, result.Error!.Code);
        Assert.False(harness.Store.Squads[harness.SquadId].IsFeatureEnabled(SquadFeature.LiveMatchTracking));
        Assert.Equal(0, harness.Store.SaveCallCount);
    }

    [Fact]
    public async Task InactiveOwner_IsRejected()
    {
        var harness = Harness.Create();
        Guid ghost = harness.SeedInactiveOwner();

        Result result = await harness.Handler.HandleAsync(
            new SetFeatureFlagCommand(ghost, harness.SquadId, SquadFeature.LiveMatchTracking, true),
            CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Equal(SquadErrorCode.Unauthorized, result.Error!.Code);
        Assert.Equal(0, harness.Store.SaveCallCount);
    }

    [Fact]
    public async Task NonMember_IsRejected()
    {
        var harness = Harness.Create();

        Result result = await harness.Handler.HandleAsync(
            new SetFeatureFlagCommand(Guid.NewGuid(), harness.SquadId, SquadFeature.LiveMatchTracking, true),
            CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Equal(SquadErrorCode.Unauthorized, result.Error!.Code);
        Assert.Equal(0, harness.Store.SaveCallCount);
    }
}

