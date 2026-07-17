using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Application.Squads.UseCases;
using PitchMate.Domain.Squads;
using DomainResult = PitchMate.Domain.Squads.Result;
using SkillTier = PitchMate.Domain.Rating.SkillTier;

namespace PitchMate.Application.Tests.Squads;

/// <summary>
/// Property-based tests for the guest-claim use cases <see cref="InitiateGuestClaimHandler"/>,
/// <see cref="RecordClaimConsentHandler"/>, <see cref="CompleteGuestClaimHandler"/>, and
/// <see cref="ReverseGuestClaimHandler"/> (squads-and-membership design Properties 30 and 31). They
/// drive the real handlers against the in-memory squad fakes and a controllable clock (no database),
/// per the Application-layer testing strategy; the Testcontainers/DB portion of Property 30 is a
/// separate task. Each property runs at least 100 iterations.
/// </summary>
[Trait("Feature", "squads-and-membership")]
public class GuestClaimProperties
{
    /// <summary>A fixed UTC anchor the fake clock reads from so audit stamps are deterministic.</summary>
    private static readonly DateTimeOffset Anchor = new(2026, 3, 1, 18, 0, 0, TimeSpan.Zero);

    // Feature: squads-and-membership, Property 30: Guest claim is a history-preserving, consent-gated,
    // reversible round trip - for any guest membership and target user with recorded consent who holds
    // no other membership in the squad, completing a claim rebinds the membership from a guest to a
    // registered Member backed by that user, sets the claim-completed indicator, and leaves the
    // membership's state and display name and its rating/stats/history unchanged; reversing that
    // completed claim rebinds it back to a guest and clears the indicator while again preserving
    // rating, stats, and history; and completion is consent-gated so it cannot complete before consent
    // is recorded.
    // Validates: Requirements 15.1, 15.2, 15.3, 15.6, 15.7
    [Property(MaxTest = 200, Arbitrary = new[] { typeof(GuestClaimGenerators) })]
    [Trait("Property", "30")]
    public Property Property30_GuestClaimIsAHistoryPreservingConsentGatedReversibleRoundTrip(ClaimRoundTripInput input)
    {
        var world = ClaimWorld.Create(input.ActorIsOwner);
        SquadMembership guest = world.SeedGuest(input.GuestDisplayName, input.SkillTier);
        Guid targetUserId = Guid.NewGuid();

        // Snapshot the stats-bearing / identity fields that must survive the round trip unchanged.
        Guid idBefore = guest.Id;
        Guid squadIdBefore = guest.SquadId;
        MembershipState stateBefore = guest.State;
        string nameBefore = guest.DisplayName;
        string? normalizedBefore = guest.DisplayNameNormalized;
        SkillTier? tierBefore = guest.SkillTier;

        // 1) Initiate the claim against the guest target: staged and committed, opening a pending claim.
        Result<InitiateGuestClaimResult> initiated = world.Initiate(guest.Id, targetUserId);
        bool initiatedOk = initiated.IsSuccess
            && world.Store.Claims.Count == 1
            && world.Store.Claims[0].State == GuestClaimState.Pending;

        // Consent gate: completing before consent is rejected and leaves the membership an unchanged guest
        // (Requirement 15.3).
        DomainResult prematureComplete = world.Complete(guest.Id);
        SquadMembership afterPremature = world.Store.FindMembershipById(idBefore)!;
        bool consentGated = !prematureComplete.IsSuccess
            && prematureComplete.Error!.Code == SquadErrorCode.ClaimNotEligible
            && afterPremature.IsGuest
            && !afterPremature.ClaimCompleted;

        // 2) The target user records consent, transitioning the claim to Consented.
        DomainResult consent = world.RecordConsent(guest.Id, targetUserId);
        bool consentOk = consent.IsSuccess
            && world.Store.Claims[0].State == GuestClaimState.Consented;

        // 3) Complete the claim: rebind guest -> registered Member backed by the target user.
        DomainResult completed = world.Complete(guest.Id);
        SquadMembership afterComplete = world.Store.FindMembershipById(idBefore)!;
        bool completedOk = completed.IsSuccess
            && !afterComplete.IsGuest
            && afterComplete.UserId == targetUserId
            && afterComplete.Role == SquadRole.Member
            && afterComplete.ClaimCompleted
            && world.Store.Claims[0].State == GuestClaimState.Completed;

        // History-preserving on completion: state, name, and seed unchanged (Requirement 15.1, 15.2).
        bool completePreservesHistory = afterComplete.Id == idBefore
            && afterComplete.SquadId == squadIdBefore
            && afterComplete.State == stateBefore
            && afterComplete.DisplayName == nameBefore
            && afterComplete.DisplayNameNormalized == normalizedBefore
            && afterComplete.SkillTier == tierBefore;

        // 4) Reverse the completed claim: rebind back to a guest and clear the indicator.
        DomainResult reversed = world.Reverse(guest.Id);
        SquadMembership afterReverse = world.Store.FindMembershipById(idBefore)!;
        bool reversedOk = reversed.IsSuccess
            && afterReverse.IsGuest
            && afterReverse.UserId is null
            && afterReverse.Role is null
            && !afterReverse.ClaimCompleted
            && world.Store.Claims[0].State == GuestClaimState.Reversed;

        // History-preserving on reversal: state, name, and seed still unchanged (Requirement 15.6).
        bool reversePreservesHistory = afterReverse.Id == idBefore
            && afterReverse.SquadId == squadIdBefore
            && afterReverse.State == stateBefore
            && afterReverse.DisplayName == nameBefore
            && afterReverse.DisplayNameNormalized == normalizedBefore
            && afterReverse.SkillTier == tierBefore;

        return (initiatedOk
            && consentGated
            && consentOk
            && completedOk
            && completePreservesHistory
            && reversedOk
            && reversePreservesHistory).ToProperty();
    }

    // Feature: squads-and-membership, Property 31: Ineligible claims and reversals are rejected - for
    // any claim initiated without recorded consent, or targeting a user who already holds any
    // membership in the squad, or targeting a membership that is not a guest, the membership is not
    // rebound and its rating, stats, and history are left unchanged; and for any reversal of a
    // membership whose claim-completed indicator is not set, the reversal is rejected and the
    // membership is left unchanged.
    // Validates: Requirements 15.3, 15.4, 15.7, 15.8
    [Property(MaxTest = 200, Arbitrary = new[] { typeof(GuestClaimGenerators) })]
    [Trait("Property", "31")]
    public Property Property31_IneligibleClaimsAndReversalsAreRejected(IneligibleCase scenario, bool actorIsOwner)
    {
        var world = ClaimWorld.Create(actorIsOwner);

        switch (scenario)
        {
            case IneligibleCase.InitiateNonGuestTarget:
            {
                // The claim target is a registered member, not a guest (Requirement 15.7).
                Guid targetMemberUserId = Guid.NewGuid();
                SquadMembership registered = world.SeedRegisteredMember(targetMemberUserId, "Registered");
                (Guid idBefore, Guid? userBefore, SquadRole? roleBefore, bool claimBefore) = Snapshot(registered);

                Result<InitiateGuestClaimResult> result = world.Initiate(registered.Id, Guid.NewGuid());
                SquadMembership after = world.Store.FindMembershipById(idBefore)!;

                return (!result.IsSuccess
                    && result.Error!.Code == SquadErrorCode.ClaimNotEligible
                    && Unchanged(after, userBefore, roleBefore, claimBefore)
                    && world.Store.Claims.Count == 0
                    && world.Store.SaveCallCount == 0).ToProperty();
            }

            case IneligibleCase.InitiateTargetUserAlreadyMember:
            {
                // The target user already holds a membership in the squad (Requirement 15.4).
                SquadMembership guest = world.SeedGuest("Claimable", null);
                Guid targetUserId = Guid.NewGuid();
                SquadMembership existing = world.SeedRegisteredMember(targetUserId, "Existing");

                (Guid guestIdBefore, Guid? guestUserBefore, SquadRole? guestRoleBefore, bool guestClaimBefore) = Snapshot(guest);
                (Guid existingIdBefore, Guid? existingUserBefore, SquadRole? existingRoleBefore, bool existingClaimBefore) = Snapshot(existing);

                Result<InitiateGuestClaimResult> result = world.Initiate(guest.Id, targetUserId);
                SquadMembership guestAfter = world.Store.FindMembershipById(guestIdBefore)!;
                SquadMembership existingAfter = world.Store.FindMembershipById(existingIdBefore)!;

                return (!result.IsSuccess
                    && result.Error!.Code == SquadErrorCode.AlreadyMember
                    && Unchanged(guestAfter, guestUserBefore, guestRoleBefore, guestClaimBefore)
                    && Unchanged(existingAfter, existingUserBefore, existingRoleBefore, existingClaimBefore)
                    && world.Store.Claims.Count == 0
                    && world.Store.SaveCallCount == 0).ToProperty();
            }

            case IneligibleCase.CompleteWithoutConsent:
            {
                // A claim is initiated but no consent recorded; completion cannot proceed (Requirement 15.3).
                SquadMembership guest = world.SeedGuest("Claimable", SkillTier.Average);
                Guid targetUserId = Guid.NewGuid();
                world.Initiate(guest.Id, targetUserId);

                (Guid idBefore, Guid? userBefore, SquadRole? roleBefore, bool claimBefore) = Snapshot(guest);
                int savesBefore = world.Store.SaveCallCount;

                DomainResult result = world.Complete(guest.Id);
                SquadMembership after = world.Store.FindMembershipById(idBefore)!;

                return (!result.IsSuccess
                    && result.Error!.Code == SquadErrorCode.ClaimNotEligible
                    && after.IsGuest
                    && Unchanged(after, userBefore, roleBefore, claimBefore)
                    && world.Store.Claims[0].State == GuestClaimState.Pending
                    && world.Store.SaveCallCount == savesBefore).ToProperty();
            }

            case IneligibleCase.ReverseWithoutCompletedClaim:
            {
                // The membership's claim-completed indicator is not set (Requirement 15.8).
                SquadMembership guest = world.SeedGuest("Claimable", SkillTier.Strong);
                (Guid idBefore, Guid? userBefore, SquadRole? roleBefore, bool claimBefore) = Snapshot(guest);

                DomainResult result = world.Reverse(guest.Id);
                SquadMembership after = world.Store.FindMembershipById(idBefore)!;

                return (!result.IsSuccess
                    && result.Error!.Code == SquadErrorCode.ClaimNotEligible
                    && after.IsGuest
                    && Unchanged(after, userBefore, roleBefore, claimBefore)
                    && world.Store.SaveCallCount == 0).ToProperty();
            }

            default:
                throw new ArgumentOutOfRangeException(nameof(scenario), scenario, "Unhandled ineligible case.");
        }
    }

    private static (Guid Id, Guid? UserId, SquadRole? Role, bool ClaimCompleted) Snapshot(SquadMembership membership) =>
        (membership.Id, membership.UserId, membership.Role, membership.ClaimCompleted);

    private static bool Unchanged(SquadMembership membership, Guid? userId, SquadRole? role, bool claimCompleted) =>
        membership.UserId == userId
        && membership.Role == role
        && membership.ClaimCompleted == claimCompleted;

    /// <summary>
    /// A small test world: a committed squad plus an active acting owner or admin, with helpers to
    /// seed claim targets and invoke each real handler against the in-memory fakes and a fixed clock.
    /// </summary>
    private sealed class ClaimWorld
    {
        public required SquadStore Store { get; init; }

        public required Guid SquadId { get; init; }

        public required Guid ActingUserId { get; init; }

        private readonly SquadFakeClock _clock = new(Anchor);

        public static ClaimWorld Create(bool actorIsOwner)
        {
            var store = new SquadStore();
            Squad squad = Squad.Create("The Squad").Value!;
            store.AddCommittedSquad(squad);

            Guid ownerUserId = Guid.NewGuid();
            SquadMembership owner = SquadMembership.CreateOwner(squad.Id, ownerUserId, "Owner").Value!;
            store.AddCommittedMembership(owner);

            Guid actingUserId = ownerUserId;
            if (!actorIsOwner)
            {
                // An admin (not the owner) acts; both are authorised owner-or-admin actors.
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

        public Result<InitiateGuestClaimResult> Initiate(Guid membershipId, Guid targetUserId) =>
            new InitiateGuestClaimHandler(
                    new FakeSquadRepository(Store),
                    new FakeSquadMembershipRepository(Store),
                    new FakeGuestClaimRepository(Store),
                    new FakeSquadUnitOfWork(Store))
                .HandleAsync(new InitiateGuestClaimCommand(ActingUserId, SquadId, membershipId, targetUserId), CancellationToken.None)
                .GetAwaiter().GetResult();

        public DomainResult RecordConsent(Guid membershipId, Guid consentingUserId) =>
            new RecordClaimConsentHandler(
                    new FakeSquadRepository(Store),
                    new FakeSquadMembershipRepository(Store),
                    new FakeGuestClaimRepository(Store),
                    new FakeSquadUnitOfWork(Store),
                    _clock)
                .HandleAsync(new RecordClaimConsentCommand(consentingUserId, SquadId, membershipId), CancellationToken.None)
                .GetAwaiter().GetResult();

        public DomainResult Complete(Guid membershipId) =>
            new CompleteGuestClaimHandler(
                    new FakeSquadRepository(Store),
                    new FakeSquadMembershipRepository(Store),
                    new FakeGuestClaimRepository(Store),
                    new FakeSquadUnitOfWork(Store),
                    _clock)
                .HandleAsync(new CompleteGuestClaimCommand(ActingUserId, SquadId, membershipId), CancellationToken.None)
                .GetAwaiter().GetResult();

        public DomainResult Reverse(Guid membershipId) =>
            new ReverseGuestClaimHandler(
                    new FakeSquadRepository(Store),
                    new FakeSquadMembershipRepository(Store),
                    new FakeGuestClaimRepository(Store),
                    new FakeSquadUnitOfWork(Store),
                    _clock)
                .HandleAsync(new ReverseGuestClaimCommand(ActingUserId, SquadId, membershipId), CancellationToken.None)
                .GetAwaiter().GetResult();
    }
}

/// <summary>The ineligible claim/reversal scenarios exercised by Property 31.</summary>
public enum IneligibleCase
{
    /// <summary>Initiating a claim against a registered (non-guest) membership (Requirement 15.7).</summary>
    InitiateNonGuestTarget,

    /// <summary>Initiating a claim for a user who already holds a membership in the squad (Requirement 15.4).</summary>
    InitiateTargetUserAlreadyMember,

    /// <summary>Completing a claim for which no consent has been recorded (Requirement 15.3).</summary>
    CompleteWithoutConsent,

    /// <summary>Reversing a membership whose claim-completed indicator is not set (Requirement 15.8).</summary>
    ReverseWithoutCompletedClaim,
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
/// tier drawn from the defined values or none, and the enumerated ineligible scenarios.
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

    private static Gen<ClaimRoundTripInput> RoundTripInputGen() =>
        from actorIsOwner in Gen.Elements(true, false)
        from name in NameGen()
        from tier in TierGen()
        select new ClaimRoundTripInput(actorIsOwner, name, tier);

    private static Gen<SkillTier?> TierGen() =>
        Gen.Elements<SkillTier?>(null, SkillTier.Beginner, SkillTier.Average, SkillTier.Strong);

    private static Gen<string> NameGen() =>
        from length in Gen.Choose(1, 50)
        from chars in ListOfLength(length, Gen.Elements(Alphabet))
        select new string(chars.ToArray());

    private static Gen<List<T>> ListOfLength<T>(int length, Gen<T> element)
    {
        if (length <= 0)
        {
            return Gen.Constant(new List<T>());
        }

        return from head in element
               from tail in ListOfLength(length - 1, element)
               select Prepend(head, tail);
    }

    private static List<T> Prepend<T>(T head, List<T> tail)
    {
        var result = new List<T>(tail.Count + 1) { head };
        result.AddRange(tail);
        return result;
    }
}
