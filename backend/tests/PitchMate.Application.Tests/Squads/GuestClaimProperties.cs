using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Application.Squads.UseCases;
using PitchMate.Domain.Auth;
using PitchMate.Domain.Squads;
using DomainResult = PitchMate.Domain.Squads.Result;
using SkillTier = PitchMate.Domain.Rating.SkillTier;

namespace PitchMate.Application.Tests.Squads;

/// <summary>
/// Property-based tests for guest claims by claim link (ADR 0003): <see cref="InitiateGuestClaimHandler"/>
/// issues the link, <see cref="AcceptGuestClaimHandler"/> lets a signed-in player accept it,
/// <see cref="CompleteGuestClaimHandler"/> lets an admin confirm, and <see cref="ReverseGuestClaimHandler"/>
/// undoes it. They drive the real handlers against the in-memory squad fakes, whose claim lookups mean
/// what the production repository's do, and a fixed clock.
/// </summary>
[Trait("Feature", "squads-and-membership")]
public class GuestClaimProperties
{
    /// <summary>A fixed UTC anchor the fake clock reads from so audit stamps are deterministic.</summary>
    private static readonly DateTimeOffset Anchor = new(2026, 10, 23, 18, 0, 0, TimeSpan.Zero);

    // Property 30: a guest claim is a history-preserving, consent-gated, reversible round trip. For any
    // guest and any player who accepts its link and holds no other membership, an admin completing the
    // claim rebinds the guest to that player and keeps its state, name and seed; it can't complete before
    // someone accepts; and reversing it rebinds it back to a guest, keeps the same history, and marks
    // the claim record Reversed.
    [Property(MaxTest = 200, Arbitrary = new[] { typeof(GuestClaimGenerators) })]
    [Trait("Property", "30")]
    public Property Property30_GuestClaimIsAHistoryPreservingConsentGatedReversibleRoundTrip(ClaimRoundTripInput input)
    {
        var world = ClaimWorld.Create(input.ActorIsOwner);
        SquadMembership guest = world.SeedGuest(input.GuestDisplayName, input.SkillTier);
        Guid playerId = Guid.NewGuid();

        Guid idBefore = guest.Id;
        MembershipState stateBefore = guest.State;
        string nameBefore = guest.DisplayName;
        string? normalizedBefore = guest.DisplayNameNormalized;
        SkillTier? tierBefore = guest.SkillTier;

        // 1) Issue the link: one pending claim, holding only the hash of the link's secret.
        Result<InitiateGuestClaimResult> issued = world.Initiate(guest.Id);
        string token = world.Secrets.LastToken!;
        bool issuedOk = issued.IsSuccess
            && world.Store.Claims.Count == 1
            && world.Store.Claims[0].State == GuestClaimState.Pending
            && world.Store.Claims[0].TokenHash == world.Secrets.Hash(token)
            && world.Store.Claims[0].TokenHash != token
            && issued.Value!.RedeemableLink.EndsWith("/claim/" + token, StringComparison.Ordinal)
            && issued.Value.ExpiresAt == Anchor + GuestClaim.LinkValidity;

        // Consent gate: completing before anyone accepts is rejected and changes nothing.
        DomainResult premature = world.Complete(guest.Id);
        bool consentGated = !premature.IsSuccess
            && premature.Error!.Code == SquadErrorCode.ClaimNotEligible
            && world.Store.FindMembershipById(idBefore)!.IsGuest;

        // 2) The player accepts the link, which binds their account but doesn't rebind the guest yet.
        Result<AcceptGuestClaimResult> accepted = world.Accept(playerId, token);
        bool acceptedOk = accepted.IsSuccess
            && accepted.Value!.SquadName == ClaimWorld.SquadName
            && world.Store.Claims[0].State == GuestClaimState.Consented
            && world.Store.Claims[0].TargetUserId == playerId
            && world.Store.FindMembershipById(idBefore)!.IsGuest;

        // 3) The admin completes it: the guest becomes the player's membership.
        DomainResult completed = world.Complete(guest.Id);
        SquadMembership afterComplete = world.Store.FindMembershipById(idBefore)!;
        bool completedOk = completed.IsSuccess
            && afterComplete.UserId == playerId
            && afterComplete.Role == SquadRole.Member
            && afterComplete.ClaimCompleted
            && world.Store.Claims[0].State == GuestClaimState.Completed
            && SameHistory(afterComplete, stateBefore, nameBefore, normalizedBefore, tierBefore);

        // 4) Reverse it: a guest again, same history, and the claim record now says Reversed.
        DomainResult reversed = world.Reverse(guest.Id);
        SquadMembership afterReverse = world.Store.FindMembershipById(idBefore)!;
        bool reversedOk = reversed.IsSuccess
            && afterReverse.IsGuest
            && afterReverse.Role is null
            && !afterReverse.ClaimCompleted
            && world.Store.Claims[0].State == GuestClaimState.Reversed
            && world.Store.Claims[0].ReversedAt == Anchor
            && SameHistory(afterReverse, stateBefore, nameBefore, normalizedBefore, tierBefore);

        return (issuedOk && consentGated && acceptedOk && completedOk && reversedOk).ToProperty();
    }

    // Property 31: ineligible claims and reversals are rejected and change nothing. Issuing a link for a
    // non-guest, accepting as someone who already holds a membership in the squad, completing a claim
    // nobody accepted, and reversing a membership with no completed claim are each refused with the
    // expected code, leaving every membership as it was.
    [Property(MaxTest = 200, Arbitrary = new[] { typeof(GuestClaimGenerators) })]
    [Trait("Property", "31")]
    public Property Property31_IneligibleClaimsAndReversalsAreRejected(IneligibleCase scenario, bool actorIsOwner)
    {
        var world = ClaimWorld.Create(actorIsOwner);

        switch (scenario)
        {
            case IneligibleCase.InitiateNonGuestTarget:
            {
                SquadMembership registered = world.SeedRegisteredMember(Guid.NewGuid(), "Registered");
                var before = Snapshot(registered);

                Result<InitiateGuestClaimResult> result = world.Initiate(registered.Id);

                return (!result.IsSuccess
                    && result.Error!.Code == SquadErrorCode.ClaimNotEligible
                    && Snapshot(world.Store.FindMembershipById(registered.Id)!) == before
                    && world.Store.Claims.Count == 0
                    && world.Store.SaveCallCount == 0).ToProperty();
            }

            case IneligibleCase.AcceptAsExistingMember:
            {
                SquadMembership guest = world.SeedGuest("Claimable", null);
                Guid playerId = Guid.NewGuid();
                SquadMembership existing = world.SeedRegisteredMember(playerId, "Existing");
                world.Initiate(guest.Id);
                int savesBefore = world.Store.SaveCallCount;
                var guestBefore = Snapshot(guest);
                var existingBefore = Snapshot(existing);

                Result<AcceptGuestClaimResult> result = world.Accept(playerId, world.Secrets.LastToken!);

                return (!result.IsSuccess
                    && result.Error!.Code == SquadErrorCode.AlreadyMember
                    && Snapshot(world.Store.FindMembershipById(guest.Id)!) == guestBefore
                    && Snapshot(world.Store.FindMembershipById(existing.Id)!) == existingBefore
                    && world.Store.Claims[0].State == GuestClaimState.Pending
                    && world.Store.Claims[0].TargetUserId is null
                    && world.Store.SaveCallCount == savesBefore).ToProperty();
            }

            case IneligibleCase.CompleteWithoutAcceptance:
            {
                SquadMembership guest = world.SeedGuest("Claimable", SkillTier.Average);
                world.Initiate(guest.Id);
                int savesBefore = world.Store.SaveCallCount;
                var before = Snapshot(guest);

                DomainResult result = world.Complete(guest.Id);

                return (!result.IsSuccess
                    && result.Error!.Code == SquadErrorCode.ClaimNotEligible
                    && Snapshot(world.Store.FindMembershipById(guest.Id)!) == before
                    && world.Store.Claims[0].State == GuestClaimState.Pending
                    && world.Store.SaveCallCount == savesBefore).ToProperty();
            }

            case IneligibleCase.ReverseWithoutCompletedClaim:
            {
                SquadMembership guest = world.SeedGuest("Claimable", SkillTier.Strong);
                var before = Snapshot(guest);

                DomainResult result = world.Reverse(guest.Id);

                return (!result.IsSuccess
                    && result.Error!.Code == SquadErrorCode.ClaimNotEligible
                    && Snapshot(world.Store.FindMembershipById(guest.Id)!) == before
                    && world.Store.SaveCallCount == 0).ToProperty();
            }

            default:
                throw new ArgumentOutOfRangeException(nameof(scenario), scenario, "Unhandled ineligible case.");
        }
    }

    // Property 32: every unusable claim link gets one uniform answer. Whether the secret is unknown, the
    // link has expired, a newer link replaced it, or someone already accepted it, both accepting and
    // previewing it fail with the same code and the same fixed message, and nothing is saved.
    [Property(MaxTest = 200, Arbitrary = new[] { typeof(GuestClaimGenerators) })]
    [Trait("Property", "32")]
    public Property Property32_EveryUnusableLinkGetsTheSameAnswer(UnusableLink kind, bool actorIsOwner)
    {
        var world = ClaimWorld.Create(actorIsOwner);
        SquadMembership guest = world.SeedGuest("Claimable", null);
        world.Initiate(guest.Id);
        string token = world.Secrets.LastToken!;
        DateTimeOffset when = Anchor;

        switch (kind)
        {
            case UnusableLink.UnknownSecret:
                token = "not-a-secret-anyone-was-given";
                break;
            case UnusableLink.Expired:
                when = Anchor + GuestClaim.LinkValidity;
                break;
            case UnusableLink.ReplacedByNewerLink:
                world.Initiate(guest.Id);
                break;
            case UnusableLink.AlreadyAccepted:
                world.Accept(Guid.NewGuid(), token);
                break;
            default:
                throw new ArgumentOutOfRangeException(nameof(kind), kind, "Unhandled unusable link.");
        }

        int savesBefore = world.Store.SaveCallCount;
        Result<AcceptGuestClaimResult> accepted = world.Accept(Guid.NewGuid(), token, when);
        Result<GuestClaimPreview> previewed = world.Preview(Guid.NewGuid(), token, when);

        bool uniform(SquadError? error) => error is not null
            && error.Code == SquadErrorCode.ClaimNotEligible
            && error.Message == GuestClaimLinkFailures.UnusableMessage;

        return (!accepted.IsSuccess
            && !previewed.IsSuccess
            && uniform(accepted.Error)
            && uniform(previewed.Error)
            && world.Store.SaveCallCount == savesBefore).ToProperty();
    }

    [Fact]
    public void IssuingANewLink_CancelsTheOpenOne_SoAGuestHasOneLiveLink()
    {
        var world = ClaimWorld.Create(actorIsOwner: true);
        SquadMembership guest = world.SeedGuest("Claimable", null);

        world.Initiate(guest.Id);
        string firstToken = world.Secrets.LastToken!;
        world.Initiate(guest.Id);

        Assert.Equal(2, world.Store.Claims.Count);
        Assert.Equal(GuestClaimState.Cancelled, world.Store.Claims[0].State);
        Assert.Equal(Anchor, world.Store.Claims[0].CancelledAt);
        Assert.Equal(GuestClaimState.Pending, world.Store.Claims[1].State);
        Assert.False(world.Accept(Guid.NewGuid(), firstToken).IsSuccess);
        Assert.True(world.Accept(Guid.NewGuid(), world.Secrets.LastToken!).IsSuccess);
    }

    [Fact]
    public void Preview_NamesTheGuestAndTheSquad_AndChangesNothing()
    {
        var world = ClaimWorld.Create(actorIsOwner: false);
        SquadMembership guest = world.SeedGuest("Big Dave", null);
        world.Initiate(guest.Id);
        int savesBefore = world.Store.SaveCallCount;

        Result<GuestClaimPreview> preview = world.Preview(Guid.NewGuid(), world.Secrets.LastToken!);

        Assert.True(preview.IsSuccess);
        Assert.Equal(new GuestClaimPreview(ClaimWorld.SquadName, "Big Dave"), preview.Value);
        Assert.Equal(GuestClaimState.Pending, world.Store.Claims[0].State);
        Assert.Equal(savesBefore, world.Store.SaveCallCount);
    }

    [Fact]
    public void ListGuestClaims_ReportsEachStage_WithTheAcceptingPlayersName()
    {
        var world = ClaimWorld.Create(actorIsOwner: true);
        SquadMembership issued = world.SeedGuest("Issued", null);
        SquadMembership expired = world.SeedGuest("Expired", null);
        SquadMembership accepted = world.SeedGuest("Accepted", null);
        SquadMembership claimed = world.SeedGuest("Claimed", null);
        world.SeedGuest("Untouched", null);

        world.Initiate(issued.Id);

        world.Initiate(expired.Id);

        world.Initiate(accepted.Id);
        User player = User.Create("Sam Player", "sam@example.test");
        world.Store.AddUser(player);
        Assert.True(world.Accept(player.Id, world.Secrets.LastToken!).IsSuccess);

        world.Initiate(claimed.Id);
        Assert.True(world.Accept(Guid.NewGuid(), world.Secrets.LastToken!).IsSuccess);
        Assert.True(world.Complete(claimed.Id).IsSuccess);

        // Every link was issued at the anchor, so reading at the end of the window shows a still-pending
        // link as expired; reading at the anchor shows it as issued.
        IReadOnlyList<GuestClaimSummary> later =
            world.ListClaims(Anchor + GuestClaim.LinkValidity).Value!;
        IReadOnlyList<GuestClaimSummary> now = world.ListClaims(Anchor).Value!;

        Assert.Equal(GuestClaimStatus.LinkIssued, now.Single(row => row.MembershipId == issued.Id).Status);
        Assert.Equal(GuestClaimStatus.LinkExpired, later.Single(row => row.MembershipId == expired.Id).Status);
        GuestClaimSummary acceptedRow = now.Single(row => row.MembershipId == accepted.Id);
        Assert.Equal(GuestClaimStatus.Accepted, acceptedRow.Status);
        Assert.Equal("Sam Player", acceptedRow.AcceptedByName);
        Assert.Equal(GuestClaimStatus.Claimed, now.Single(row => row.MembershipId == claimed.Id).Status);
        Assert.Equal(4, now.Count);
    }

    [Fact]
    public void ListGuestClaims_IsForOwnersAndAdminsOnly()
    {
        var world = ClaimWorld.Create(actorIsOwner: true);
        Guid memberUserId = Guid.NewGuid();
        world.SeedRegisteredMember(memberUserId, "Plain Member");

        Result<IReadOnlyList<GuestClaimSummary>> result = world.ListClaims(Anchor, memberUserId);

        Assert.False(result.IsSuccess);
        Assert.Equal(SquadErrorCode.Unauthorized, result.Error!.Code);
    }

    private static (Guid Id, Guid? UserId, SquadRole? Role, bool ClaimCompleted) Snapshot(SquadMembership membership) =>
        (membership.Id, membership.UserId, membership.Role, membership.ClaimCompleted);

    private static bool SameHistory(
        SquadMembership membership,
        MembershipState state,
        string name,
        string? normalized,
        SkillTier? tier) =>
        membership.State == state
        && membership.DisplayName == name
        && membership.DisplayNameNormalized == normalized
        && membership.SkillTier == tier;

    /// <summary>
    /// A small test world: a committed squad plus an active acting owner or admin, a deterministic
    /// claim-secret service, and helpers that invoke each real handler against the in-memory fakes.
    /// </summary>
    private sealed class ClaimWorld
    {
        public const string SquadName = "The Squad";

        public required SquadStore Store { get; init; }

        public required Guid SquadId { get; init; }

        public required Guid ActingUserId { get; init; }

        public FakeClaimSecretService Secrets { get; } = new();

        public static ClaimWorld Create(bool actorIsOwner)
        {
            var store = new SquadStore();
            Squad squad = Squad.Create(SquadName).Value!;
            store.AddCommittedSquad(squad);

            Guid ownerUserId = Guid.NewGuid();
            store.AddCommittedMembership(SquadMembership.CreateOwner(squad.Id, ownerUserId, "Owner").Value!);

            Guid actingUserId = ownerUserId;
            if (!actorIsOwner)
            {
                Guid adminUserId = Guid.NewGuid();
                SquadMembership admin = SquadMembership.CreateRegistered(squad.Id, adminUserId, "Admin").Value!;
                admin.PromoteToAdmin();
                store.AddCommittedMembership(admin);
                actingUserId = adminUserId;
            }

            return new ClaimWorld { Store = store, SquadId = squad.Id, ActingUserId = actingUserId };
        }

        public SquadMembership SeedGuest(string displayName, SkillTier? skillTier)
        {
            SquadMembership guest = SquadMembership.CreateGuest(SquadId, displayName, skillTier, Anchor).Value!;
            Store.AddCommittedMembership(guest);
            return guest;
        }

        public SquadMembership SeedRegisteredMember(Guid userId, string displayName)
        {
            SquadMembership member = SquadMembership.CreateRegistered(SquadId, userId, displayName).Value!;
            Store.AddCommittedMembership(member);
            return member;
        }

        public Result<InitiateGuestClaimResult> Initiate(Guid membershipId) =>
            new InitiateGuestClaimHandler(
                    new FakeSquadRepository(Store),
                    new FakeSquadMembershipRepository(Store),
                    new FakeGuestClaimRepository(Store),
                    Secrets,
                    new FakeSquadUnitOfWork(Store),
                    new SquadFakeClock(Anchor))
                .HandleAsync(new InitiateGuestClaimCommand(ActingUserId, SquadId, membershipId), CancellationToken.None)
                .GetAwaiter().GetResult();

        public Result<AcceptGuestClaimResult> Accept(Guid playerId, string secret, DateTimeOffset? at = null) =>
            new AcceptGuestClaimHandler(
                    Secrets,
                    new FakeGuestClaimRepository(Store),
                    new FakeSquadMembershipRepository(Store),
                    new FakeSquadRepository(Store),
                    new FakeSquadUnitOfWork(Store),
                    new SquadFakeClock(at ?? Anchor))
                .HandleAsync(new AcceptGuestClaimCommand(playerId, secret), CancellationToken.None)
                .GetAwaiter().GetResult();

        public Result<GuestClaimPreview> Preview(Guid playerId, string secret, DateTimeOffset? at = null) =>
            new PreviewGuestClaimHandler(
                    Secrets,
                    new FakeGuestClaimRepository(Store),
                    new FakeSquadMembershipRepository(Store),
                    new FakeSquadRepository(Store),
                    new SquadFakeClock(at ?? Anchor))
                .HandleAsync(new PreviewGuestClaimCommand(playerId, secret), CancellationToken.None)
                .GetAwaiter().GetResult();

        public Result<IReadOnlyList<GuestClaimSummary>> ListClaims(DateTimeOffset at, Guid? asUser = null) =>
            new ListGuestClaimsHandler(
                    new FakeSquadRepository(Store),
                    new FakeSquadMembershipRepository(Store),
                    new FakeGuestClaimRepository(Store),
                    new FakeUserRepository(Store),
                    new SquadFakeClock(at))
                .HandleAsync(new ListGuestClaimsCommand(asUser ?? ActingUserId, SquadId), CancellationToken.None)
                .GetAwaiter().GetResult();

        public DomainResult Complete(Guid membershipId) =>
            new CompleteGuestClaimHandler(
                    new FakeSquadRepository(Store),
                    new FakeSquadMembershipRepository(Store),
                    new FakeGuestClaimRepository(Store),
                    new FakeSquadUnitOfWork(Store),
                    new SquadFakeClock(Anchor))
                .HandleAsync(new CompleteGuestClaimCommand(ActingUserId, SquadId, membershipId), CancellationToken.None)
                .GetAwaiter().GetResult();

        public DomainResult Reverse(Guid membershipId) =>
            new ReverseGuestClaimHandler(
                    new FakeSquadRepository(Store),
                    new FakeSquadMembershipRepository(Store),
                    new FakeGuestClaimRepository(Store),
                    new FakeSquadUnitOfWork(Store),
                    new SquadFakeClock(Anchor))
                .HandleAsync(new ReverseGuestClaimCommand(ActingUserId, SquadId, membershipId), CancellationToken.None)
                .GetAwaiter().GetResult();
    }
}

/// <summary>The ineligible claim and reversal scenarios exercised by Property 31.</summary>
public enum IneligibleCase
{
    /// <summary>Issuing a claim link for a registered (non-guest) membership.</summary>
    InitiateNonGuestTarget,

    /// <summary>Accepting a link as a player who already holds a membership in the squad.</summary>
    AcceptAsExistingMember,

    /// <summary>Completing a claim nobody has accepted.</summary>
    CompleteWithoutAcceptance,

    /// <summary>Reversing a membership whose claim-completed indicator is not set.</summary>
    ReverseWithoutCompletedClaim,
}

/// <summary>The ways a claim link can be unusable, exercised by Property 32.</summary>
public enum UnusableLink
{
    /// <summary>A secret no link was ever issued for.</summary>
    UnknownSecret,

    /// <summary>A link presented at or after its expiry.</summary>
    Expired,

    /// <summary>A link an admin replaced by issuing a newer one.</summary>
    ReplacedByNewerLink,

    /// <summary>A link someone has already accepted.</summary>
    AlreadyAccepted,
}

/// <summary>
/// A single guest-claim round-trip input for Property 30: whether the acting requester is the owner or
/// an admin, a valid trimmed guest display name (1..50 characters), and an optional cold-start skill
/// tier that must survive the claim unchanged.
/// </summary>
/// <param name="ActorIsOwner">Whether the acting requester is the owner (otherwise an admin).</param>
/// <param name="GuestDisplayName">A display name whose trimmed length is 1..50.</param>
/// <param name="SkillTier">An optional cold-start skill-tier seed, or <see langword="null"/> for none.</param>
public sealed record ClaimRoundTripInput(bool ActorIsOwner, string GuestDisplayName, SkillTier? SkillTier);

/// <summary>
/// FsCheck arbitraries for the guest-claim properties. Smart generators constrain inputs to the valid
/// space: an owner-or-admin actor, a guest display name of trimmed length 1..50, an optional skill
/// tier drawn from the defined values or none, and the enumerated scenarios.
/// </summary>
public static class GuestClaimGenerators
{
    private static readonly char[] Alphabet =
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".ToCharArray();

    /// <summary>Arbitrary for a single round-trip input.</summary>
    public static Arbitrary<ClaimRoundTripInput> ClaimRoundTripInput() => Arb.From(RoundTripInputGen());

    /// <summary>Arbitrary for the enumerated ineligible scenarios.</summary>
    public static Arbitrary<IneligibleCase> IneligibleCase() =>
        Arb.From(Gen.Elements(Enum.GetValues<IneligibleCase>()));

    /// <summary>Arbitrary for the enumerated unusable links.</summary>
    public static Arbitrary<UnusableLink> UnusableLink() =>
        Arb.From(Gen.Elements(Enum.GetValues<UnusableLink>()));

    private static Gen<ClaimRoundTripInput> RoundTripInputGen() =>
        from actorIsOwner in Gen.Elements(true, false)
        from name in NameGen()
        from tier in TierGen()
        select new ClaimRoundTripInput(actorIsOwner, name, tier);

    private static Gen<SkillTier?> TierGen() =>
        Gen.Elements<SkillTier?>(null, SkillTier.Beginner, SkillTier.Average, SkillTier.Strong);

    private static Gen<string> NameGen() =>
        from length in Gen.Choose(1, 50)
        from chars in Gen.ArrayOf(Gen.Elements(Alphabet), length)
        select new string(chars);
}
