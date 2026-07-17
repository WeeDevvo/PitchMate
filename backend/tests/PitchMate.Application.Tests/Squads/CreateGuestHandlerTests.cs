using PitchMate.Application.Squads.UseCases;
using PitchMate.Domain.Squads;
using SkillTier = PitchMate.Domain.Rating.SkillTier;

namespace PitchMate.Application.Tests.Squads;

/// <summary>
/// Example/unit tests for <see cref="CreateGuestHandler"/>: an active owner or admin creates a unique,
/// optionally seeded guest with a recorded lawful-basis acknowledgement (Requirement 14.1, 14.5,
/// 14.7, 14.10); a missing acknowledgement (14.4), an undefined skill tier (14.6), an invalid length
/// (14.3), and a display-name collision (3.2, 14.8) are each rejected creating no guest; and every
/// non-owner/admin actor is rejected with the uniform authorisation failure (14.2). The seeded/audited
/// invariant is additionally covered as a named property by task 13.2.
/// </summary>
[Trait("Feature", "squads-and-membership")]
public class CreateGuestHandlerTests
{
    private static readonly DateTimeOffset Now = new(2026, 1, 15, 9, 30, 0, TimeSpan.Zero);

    private sealed class Harness
    {
        public required SquadStore Store { get; init; }
        public required CreateGuestHandler Handler { get; init; }
        public required Guid SquadId { get; init; }

        public static Harness Create(bool throwOnSave = false, bool softDeleted = false)
        {
            var store = new SquadStore();
            Squad squad = Squad.Create("The Squad").Value!;
            store.AddCommittedSquad(squad, softDeleted);

            var handler = new CreateGuestHandler(
                new FakeSquadRepository(store),
                new FakeSquadMembershipRepository(store),
                new FakeSquadUnitOfWork(store, throwOnSave),
                new SquadFakeClock(Now));

            return new Harness { Store = store, Handler = handler, SquadId = squad.Id };
        }

        public Guid SeedOwner(string name = "Owner")
        {
            Guid userId = Guid.NewGuid();
            Store.AddCommittedMembership(SquadMembership.CreateOwner(SquadId, userId, name).Value!);
            return userId;
        }

        public Guid SeedAdmin(string name = "Admin")
        {
            Guid userId = Guid.NewGuid();
            SquadMembership admin = SquadMembership.CreateRegistered(SquadId, userId, name).Value!;
            admin.PromoteToAdmin();
            Store.AddCommittedMembership(admin);
            return userId;
        }

        public Guid SeedMember(string name = "Member")
        {
            Guid userId = Guid.NewGuid();
            Store.AddCommittedMembership(SquadMembership.CreateRegistered(SquadId, userId, name).Value!);
            return userId;
        }

        public void SeedGuest(string name)
        {
            Store.AddCommittedMembership(
                SquadMembership.CreateGuest(SquadId, name, skillTier: null, Now).Value!);
        }
    }

    [Fact]
    public async Task Owner_CreatesActiveGuest_WithTierAndRecordedAcknowledgement()
    {
        var harness = Harness.Create();
        Guid owner = harness.SeedOwner();

        Result<CreateGuestResult> result = await harness.Handler.HandleAsync(
            new CreateGuestCommand(owner, harness.SquadId, "Dave", SkillTier.Strong, LawfulBasisAcknowledged: true),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        SquadMembership guest = Assert.Single(harness.Store.Memberships, m => m.IsGuest);
        Assert.Equal(result.Value!.GuestMembershipId, guest.Id);
        Assert.Equal("Dave", guest.DisplayName);
        Assert.Equal(MembershipState.Active, guest.State);
        Assert.Null(guest.UserId);
        Assert.Null(guest.Role);
        Assert.Equal(SkillTier.Strong, guest.SkillTier);
        Assert.Equal(Now, guest.LawfulBasisAcknowledgedAt);
        Assert.Equal(1, harness.Store.SaveCallCount);
    }

    [Fact]
    public async Task Admin_CreatesGuest_WithNoTier_RecordsNoSeed()
    {
        var harness = Harness.Create();
        Guid admin = harness.SeedAdmin();

        Result<CreateGuestResult> result = await harness.Handler.HandleAsync(
            new CreateGuestCommand(admin, harness.SquadId, "BigDave", SkillTier: null, LawfulBasisAcknowledged: true),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        SquadMembership guest = Assert.Single(harness.Store.Memberships, m => m.IsGuest);
        Assert.Null(guest.SkillTier);
    }

    [Fact]
    public async Task MissingLawfulBasisAcknowledgement_IsRejected_AndCreatesNoGuest()
    {
        var harness = Harness.Create();
        Guid owner = harness.SeedOwner();

        Result<CreateGuestResult> result = await harness.Handler.HandleAsync(
            new CreateGuestCommand(owner, harness.SquadId, "Dave", SkillTier.Average, LawfulBasisAcknowledged: false),
            CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Equal(SquadErrorCode.ValidationFailed, result.Error!.Code);
        Assert.DoesNotContain(harness.Store.Memberships, m => m.IsGuest);
        Assert.Equal(0, harness.Store.SaveCallCount);
    }

    [Fact]
    public async Task UndefinedSkillTier_IsRejected_AndCreatesNoGuest()
    {
        var harness = Harness.Create();
        Guid owner = harness.SeedOwner();
        var undefined = (SkillTier)9999;

        Result<CreateGuestResult> result = await harness.Handler.HandleAsync(
            new CreateGuestCommand(owner, harness.SquadId, "Dave", undefined, LawfulBasisAcknowledged: true),
            CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Equal(SquadErrorCode.ValidationFailed, result.Error!.Code);
        Assert.DoesNotContain(harness.Store.Memberships, m => m.IsGuest);
        Assert.Equal(0, harness.Store.SaveCallCount);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task InvalidDisplayNameLength_IsRejected_AndCreatesNoGuest(string name)
    {
        var harness = Harness.Create();
        Guid owner = harness.SeedOwner();

        Result<CreateGuestResult> result = await harness.Handler.HandleAsync(
            new CreateGuestCommand(owner, harness.SquadId, name, SkillTier: null, LawfulBasisAcknowledged: true),
            CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Equal(SquadErrorCode.ValidationFailed, result.Error!.Code);
        Assert.DoesNotContain(harness.Store.Memberships, m => m.IsGuest);
        Assert.Equal(0, harness.Store.SaveCallCount);
    }

    [Fact]
    public async Task DisplayNameCollision_CaseInsensitive_IsRejected_AndCreatesNoGuest()
    {
        var harness = Harness.Create();
        Guid owner = harness.SeedOwner();
        harness.SeedGuest("Dave");

        Result<CreateGuestResult> result = await harness.Handler.HandleAsync(
            new CreateGuestCommand(owner, harness.SquadId, "  dave  ", SkillTier: null, LawfulBasisAcknowledged: true),
            CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Equal(SquadErrorCode.DisplayNameInUse, result.Error!.Code);
        // Only the seeded guest exists; none was added.
        Assert.Single(harness.Store.Memberships, m => m.IsGuest);
        Assert.Equal(0, harness.Store.SaveCallCount);
    }

    [Fact]
    public async Task Member_IsRejected_WithUniformAuthorisationFailure()
    {
        var harness = Harness.Create();
        Guid member = harness.SeedMember();

        Result<CreateGuestResult> result = await harness.Handler.HandleAsync(
            new CreateGuestCommand(member, harness.SquadId, "Dave", SkillTier: null, LawfulBasisAcknowledged: true),
            CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Equal(SquadErrorCode.Unauthorized, result.Error!.Code);
        Assert.DoesNotContain(harness.Store.Memberships, m => m.IsGuest);
        Assert.Equal(0, harness.Store.SaveCallCount);
    }

    [Fact]
    public async Task NonMember_IsRejected_WithUniformAuthorisationFailure()
    {
        var harness = Harness.Create();

        Result<CreateGuestResult> result = await harness.Handler.HandleAsync(
            new CreateGuestCommand(Guid.NewGuid(), harness.SquadId, "Dave", SkillTier: null, LawfulBasisAcknowledged: true),
            CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Equal(SquadErrorCode.Unauthorized, result.Error!.Code);
        Assert.Equal(0, harness.Store.SaveCallCount);
    }

    [Fact]
    public async Task PendingDeletionSquad_IsRejected_WithoutRevealingExistence()
    {
        var harness = Harness.Create(softDeleted: true);
        Guid owner = harness.SeedOwner();

        Result<CreateGuestResult> result = await harness.Handler.HandleAsync(
            new CreateGuestCommand(owner, harness.SquadId, "Dave", SkillTier: null, LawfulBasisAcknowledged: true),
            CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Equal(SquadErrorCode.Unauthorized, result.Error!.Code);
        Assert.Equal(0, harness.Store.SaveCallCount);
    }
}
