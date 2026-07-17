using PitchMate.Application.Squads.UseCases;
using PitchMate.Domain.Squads;
using SkillTier = PitchMate.Domain.Rating.SkillTier;

namespace PitchMate.Application.Tests.Squads;

/// <summary>
/// Example/unit tests for <see cref="EditGuestHandler"/>: an active owner or admin renames a guest
/// and/or updates its skill-tier seed under the case-insensitive uniqueness rule (Requirement 3.2,
/// 14.6); a colliding name (3.2), an invalid length, an undefined tier (14.6), a non-guest target, an
/// unknown/foreign target, and a non-owner/admin actor (14.2) are each rejected leaving the guest
/// unchanged.
/// </summary>
[Trait("Feature", "squads-and-membership")]
public class EditGuestHandlerTests
{
    private static readonly DateTimeOffset Now = new(2026, 1, 15, 9, 30, 0, TimeSpan.Zero);

    private sealed class Harness
    {
        public required SquadStore Store { get; init; }
        public required EditGuestHandler Handler { get; init; }
        public required Guid SquadId { get; init; }

        public static Harness Create(bool throwOnSave = false, bool softDeleted = false)
        {
            var store = new SquadStore();
            Squad squad = Squad.Create("The Squad").Value!;
            store.AddCommittedSquad(squad, softDeleted);

            var handler = new EditGuestHandler(
                new FakeSquadRepository(store),
                new FakeSquadMembershipRepository(store),
                new FakeSquadUnitOfWork(store, throwOnSave));

            return new Harness { Store = store, Handler = handler, SquadId = squad.Id };
        }

        public Guid SeedOwner(string name = "Owner")
        {
            Guid userId = Guid.NewGuid();
            Store.AddCommittedMembership(SquadMembership.CreateOwner(SquadId, userId, name).Value!);
            return userId;
        }

        public Guid SeedMember(string name = "Member")
        {
            Guid userId = Guid.NewGuid();
            Store.AddCommittedMembership(SquadMembership.CreateRegistered(SquadId, userId, name).Value!);
            return userId;
        }

        public SquadMembership SeedGuest(string name, SkillTier? tier = null)
        {
            SquadMembership guest = SquadMembership.CreateGuest(SquadId, name, tier, Now).Value!;
            Store.AddCommittedMembership(guest);
            return guest;
        }
    }

    [Fact]
    public async Task Owner_RenamesGuest_AndUpdatesTier()
    {
        var harness = Harness.Create();
        Guid owner = harness.SeedOwner();
        SquadMembership guest = harness.SeedGuest("Dave", SkillTier.Beginner);

        Result result = await harness.Handler.HandleAsync(
            new EditGuestCommand(owner, harness.SquadId, guest.Id, "BigDave", UpdateSkillTier: true, SkillTier.Strong),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal("BigDave", guest.DisplayName);
        Assert.Equal(SkillTier.Strong, guest.SkillTier);
        Assert.Equal(1, harness.Store.SaveCallCount);
    }

    [Fact]
    public async Task RenameOnly_LeavesTierUnchanged()
    {
        var harness = Harness.Create();
        Guid owner = harness.SeedOwner();
        SquadMembership guest = harness.SeedGuest("Dave", SkillTier.Average);

        Result result = await harness.Handler.HandleAsync(
            new EditGuestCommand(owner, harness.SquadId, guest.Id, "Davey"),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal("Davey", guest.DisplayName);
        Assert.Equal(SkillTier.Average, guest.SkillTier);
    }

    [Fact]
    public async Task TierUpdateToNull_ClearsSeed_WithoutRenaming()
    {
        var harness = Harness.Create();
        Guid owner = harness.SeedOwner();
        SquadMembership guest = harness.SeedGuest("Dave", SkillTier.Strong);

        Result result = await harness.Handler.HandleAsync(
            new EditGuestCommand(owner, harness.SquadId, guest.Id, DisplayName: null, UpdateSkillTier: true, SkillTier: null),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal("Dave", guest.DisplayName);
        Assert.Null(guest.SkillTier);
    }

    [Fact]
    public async Task RenamingToOwnName_CaseChange_IsAllowed()
    {
        var harness = Harness.Create();
        Guid owner = harness.SeedOwner();
        SquadMembership guest = harness.SeedGuest("Dave");

        Result result = await harness.Handler.HandleAsync(
            new EditGuestCommand(owner, harness.SquadId, guest.Id, "DAVE"),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal("DAVE", guest.DisplayName);
    }

    [Fact]
    public async Task RenameCollision_IsRejected_AndLeavesGuestUnchanged()
    {
        var harness = Harness.Create();
        Guid owner = harness.SeedOwner();
        harness.SeedGuest("Taken");
        SquadMembership guest = harness.SeedGuest("Dave");

        Result result = await harness.Handler.HandleAsync(
            new EditGuestCommand(owner, harness.SquadId, guest.Id, "  taken  "),
            CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Equal(SquadErrorCode.DisplayNameInUse, result.Error!.Code);
        Assert.Equal("Dave", guest.DisplayName);
        Assert.Equal(0, harness.Store.SaveCallCount);
    }

    [Fact]
    public async Task InvalidRenameLength_IsRejected_AndLeavesGuestUnchanged()
    {
        var harness = Harness.Create();
        Guid owner = harness.SeedOwner();
        SquadMembership guest = harness.SeedGuest("Dave");

        Result result = await harness.Handler.HandleAsync(
            new EditGuestCommand(owner, harness.SquadId, guest.Id, "   "),
            CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Equal(SquadErrorCode.ValidationFailed, result.Error!.Code);
        Assert.Equal("Dave", guest.DisplayName);
        Assert.Equal(0, harness.Store.SaveCallCount);
    }

    [Fact]
    public async Task UndefinedTier_IsRejected_AndLeavesGuestUnchanged()
    {
        var harness = Harness.Create();
        Guid owner = harness.SeedOwner();
        SquadMembership guest = harness.SeedGuest("Dave", SkillTier.Beginner);
        var undefined = (SkillTier)9999;

        Result result = await harness.Handler.HandleAsync(
            new EditGuestCommand(owner, harness.SquadId, guest.Id, DisplayName: null, UpdateSkillTier: true, undefined),
            CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Equal(SquadErrorCode.ValidationFailed, result.Error!.Code);
        Assert.Equal(SkillTier.Beginner, guest.SkillTier);
        Assert.Equal(0, harness.Store.SaveCallCount);
    }

    [Fact]
    public async Task NonGuestTarget_IsRejected()
    {
        var harness = Harness.Create();
        Guid owner = harness.SeedOwner();
        Guid memberUser = harness.SeedMember("Reg");
        SquadMembership registered = harness.Store.Memberships.Single(m => m.UserId == memberUser);

        Result result = await harness.Handler.HandleAsync(
            new EditGuestCommand(owner, harness.SquadId, registered.Id, "NewName"),
            CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Equal(SquadErrorCode.ValidationFailed, result.Error!.Code);
        Assert.Equal("Reg", registered.DisplayName);
        Assert.Equal(0, harness.Store.SaveCallCount);
    }

    [Fact]
    public async Task UnknownTarget_IsRejected_AsNotAMember()
    {
        var harness = Harness.Create();
        Guid owner = harness.SeedOwner();

        Result result = await harness.Handler.HandleAsync(
            new EditGuestCommand(owner, harness.SquadId, Guid.NewGuid(), "NewName"),
            CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Equal(SquadErrorCode.NotAMember, result.Error!.Code);
    }

    [Fact]
    public async Task ForeignSquadTarget_IsRejected_AsNotAMember()
    {
        var harness = Harness.Create();
        Guid owner = harness.SeedOwner();
        // A guest belonging to a different squad.
        SquadMembership foreign = SquadMembership.CreateGuest(Guid.NewGuid(), "Elsewhere", null, Now).Value!;
        harness.Store.AddCommittedMembership(foreign);

        Result result = await harness.Handler.HandleAsync(
            new EditGuestCommand(owner, harness.SquadId, foreign.Id, "NewName"),
            CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Equal(SquadErrorCode.NotAMember, result.Error!.Code);
        Assert.Equal("Elsewhere", foreign.DisplayName);
    }

    [Fact]
    public async Task Member_IsRejected_WithUniformAuthorisationFailure()
    {
        var harness = Harness.Create();
        Guid member = harness.SeedMember();
        SquadMembership guest = harness.SeedGuest("Dave");

        Result result = await harness.Handler.HandleAsync(
            new EditGuestCommand(member, harness.SquadId, guest.Id, "BigDave"),
            CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Equal(SquadErrorCode.Unauthorized, result.Error!.Code);
        Assert.Equal("Dave", guest.DisplayName);
        Assert.Equal(0, harness.Store.SaveCallCount);
    }

    [Fact]
    public async Task NoEditRequested_IsNoOpSuccess_WithoutCommitting()
    {
        var harness = Harness.Create();
        Guid owner = harness.SeedOwner();
        SquadMembership guest = harness.SeedGuest("Dave", SkillTier.Average);

        Result result = await harness.Handler.HandleAsync(
            new EditGuestCommand(owner, harness.SquadId, guest.Id),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal("Dave", guest.DisplayName);
        Assert.Equal(SkillTier.Average, guest.SkillTier);
        Assert.Equal(0, harness.Store.SaveCallCount);
    }
}
