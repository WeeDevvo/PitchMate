using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Application.Squads.UseCases;
using PitchMate.Domain.Auth;
using PitchMate.Domain.Squads;

namespace PitchMate.Application.Tests.Squads;

/// <summary>
/// Property-based tests for <see cref="RedeemInviteHandler"/> covering redemption and reactivation
/// (squads-and-membership design Properties 18 and 19). They drive the real handler against the
/// in-memory squad fakes and a controllable clock (no database), per the Application-layer testing
/// strategy. A redeemable invite is seeded whose stored one-way token hash matches the hash the
/// deterministic <see cref="FakeInviteSecretService"/> derives from the presented secret, so the
/// handler resolves the invite exactly as production would. Each property runs at least 100
/// iterations; accompanying unit tests pin the join display-name rules (Requirements 11.7, 11.8).
/// </summary>
[Trait("Feature", "squads-and-membership")]
public class RedemptionReactivationProperties
{
    /// <summary>A fixed UTC anchor the fake clock reads from; the seeded invite expires well after it.</summary>
    private static readonly DateTimeOffset Anchor = new(2025, 1, 1, 12, 0, 0, TimeSpan.Zero);

    /// <summary>The secret presented for redemption; the seeded invite stores only its one-way hash.</summary>
    private const string PresentedSecret = "join-secret-token";

    /// <summary>The name shared by the returning member and a colliding member in Property 19.</summary>
    private const string CollisionName = "Dave";

    private static readonly char[] Alphabet =
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ".ToCharArray();

    /// <summary>The starting state of the user's existing membership when the invite is redeemed.</summary>
    public enum StartState
    {
        InactiveMember,
        InactiveAdmin,
        InactiveOwner,
        ActiveMember,
        ActiveAdmin,
        ActiveOwner,
    }

    /// <summary>How the caller resolves (or fails to resolve) a colliding display name on reactivation.</summary>
    public enum Resolution
    {
        KeepCurrentName,
        SupplyCollidingName,
        SupplyInvalidName,
        SupplyFreshName,
    }

    // Feature: squads-and-membership, Property 18: Re-joining reactivates the same membership - for any
    // user holding an Inactive registered membership who redeems a redeemable invite, that same
    // membership becomes Active with no second membership created, its identity/squad/user backing and
    // stats-bearing fields are preserved, an Admin is reset to Member while an Owner is retained; and a
    // user who already holds an Active membership redeems to a no-op AlreadyMember with no new
    // membership and no change.
    // Validates: Requirements 9.1, 9.3, 9.4, 9.6, 11.3, 11.4
    [Property(MaxTest = 300)]
    [Trait("Property", "18")]
    public Property Property18_ReJoiningReactivatesTheSameMembership() =>
        Prop.ForAll(
            Arb.From(Gen.Elements(Enum.GetValues<StartState>())),
            startState =>
            {
                var clock = new SquadFakeClock(Anchor);
                var secrets = new FakeInviteSecretService();
                (SquadStore store, Guid squadId) = SeedSquadWithInvite(secrets, clock);

                Guid userId = Guid.NewGuid();
                SquadMembership subject = BuildExisting(squadId, userId, startState);
                store.AddCommittedMembership(subject);

                // Snapshot the fields that must survive reactivation unchanged (identity, backing, and
                // the seed/claim/audit state that stands in for retained rating, stats, and history).
                Guid idBefore = subject.Id;
                Guid squadIdBefore = subject.SquadId;
                Guid? userIdBefore = subject.UserId;
                string displayNameBefore = subject.DisplayName;
                string? normalizedBefore = subject.DisplayNameNormalized;
                var skillTierBefore = subject.SkillTier;
                bool claimBefore = subject.ClaimCompleted;
                var lawfulBasisBefore = subject.LawfulBasisAcknowledgedAt;
                int membershipCountBefore = store.Memberships.Count;

                RedeemInviteHandler handler = BuildHandler(store, secrets, clock);

                Result<RedeemInviteResult> result = handler
                    .HandleAsync(new RedeemInviteCommand(userId, PresentedSecret), CancellationToken.None)
                    .GetAwaiter()
                    .GetResult();

                SquadMembership after = store.FindMembershipById(idBefore)!;

                // No second membership is ever created, and identity/squad/user backing is preserved.
                bool noSecondMembership = store.Memberships.Count == membershipCountBefore;
                bool identityPreserved = after.Id == idBefore
                    && after.SquadId == squadIdBefore
                    && after.UserId == userIdBefore;

                // Stats-bearing / audit fields are untouched, and the returned id is the same membership.
                bool historyPreserved = after.SkillTier == skillTierBefore
                    && after.ClaimCompleted == claimBefore
                    && after.LawfulBasisAcknowledgedAt == lawfulBasisBefore;
                bool sameMembershipReturned = result.IsSuccess && result.Value!.MembershipId == idBefore;

                bool wasInactive = startState is StartState.InactiveMember
                    or StartState.InactiveAdmin
                    or StartState.InactiveOwner;

                if (wasInactive)
                {
                    // Reactivated in place: Active, name unchanged (no collision), Admin->Member, Owner kept.
                    SquadRole? expectedRole = startState == StartState.InactiveOwner
                        ? SquadRole.Owner
                        : SquadRole.Member;

                    bool reactivated = result.IsSuccess
                        && result.Value!.Outcome == RedeemOutcome.Reactivated
                        && after.State == MembershipState.Active
                        && after.Role == expectedRole
                        && after.DisplayName == displayNameBefore
                        && after.DisplayNameNormalized == normalizedBefore
                        && store.SaveCallCount == 1;

                    return (reactivated
                        && noSecondMembership
                        && identityPreserved
                        && historyPreserved
                        && sameMembershipReturned).ToProperty();
                }

                // Already active: no-op AlreadyMember, nothing persisted, role and state unchanged.
                SquadRole? roleBefore = startState switch
                {
                    StartState.ActiveAdmin => SquadRole.Admin,
                    StartState.ActiveOwner => SquadRole.Owner,
                    _ => SquadRole.Member,
                };

                bool alreadyMember = result.IsSuccess
                    && result.Value!.Outcome == RedeemOutcome.AlreadyMember
                    && after.State == MembershipState.Active
                    && after.Role == roleBefore
                    && after.DisplayName == displayNameBefore
                    && store.SaveCallCount == 0;

                return (alreadyMember
                    && noSecondMembership
                    && identityPreserved
                    && historyPreserved
                    && sameMembershipReturned).ToProperty();
            });

    // Feature: squads-and-membership, Property 19: Reactivation requires a unique display name - when a
    // returning member's current display name would collide (after trimming and case-insensitive
    // comparison) with another non-anonymised membership, reactivation is rejected and the membership
    // stays Inactive until a distinct display name of trimmed length 1..50 is supplied, at which point
    // it reactivates under the new name.
    // Validates: Requirements 9.5, 11.7
    [Property(MaxTest = 300)]
    [Trait("Property", "19")]
    public Property Property19_ReactivationRequiresAUniqueDisplayName() =>
        Prop.ForAll(
            Arb.From(Gen.Elements(Enum.GetValues<Resolution>())),
            Arb.From(FreshNameGen()),
            Arb.From(InvalidNameGen()),
            (resolution, freshName, invalidName) =>
            {
                var clock = new SquadFakeClock(Anchor);
                var secrets = new FakeInviteSecretService();
                (SquadStore store, Guid squadId) = SeedSquadWithInvite(secrets, clock);

                // The returning member is inactive and named "Dave"; another active member also holds
                // "Dave", so the returning member's current name now collides with a live membership.
                Guid userId = Guid.NewGuid();
                SquadMembership subject = SquadMembership.CreateRegistered(squadId, userId, CollisionName).Value!;
                subject.Deactivate();
                store.AddCommittedMembership(subject);

                SquadMembership other = SquadMembership
                    .CreateRegistered(squadId, Guid.NewGuid(), CollisionName).Value!;
                store.AddCommittedMembership(other);

                int membershipCountBefore = store.Memberships.Count;

                string? suppliedName = resolution switch
                {
                    Resolution.KeepCurrentName => null,
                    Resolution.SupplyCollidingName => "  DAVE  ",
                    Resolution.SupplyInvalidName => invalidName,
                    Resolution.SupplyFreshName => freshName,
                    _ => null,
                };

                RedeemInviteHandler handler = BuildHandler(store, secrets, clock);

                Result<RedeemInviteResult> result = handler
                    .HandleAsync(new RedeemInviteCommand(userId, PresentedSecret, suppliedName), CancellationToken.None)
                    .GetAwaiter()
                    .GetResult();

                SquadMembership after = store.FindMembershipById(subject.Id)!;
                bool noSecondMembership = store.Memberships.Count == membershipCountBefore;

                if (resolution == Resolution.SupplyFreshName)
                {
                    // A distinct, valid name reactivates the same membership under the new name.
                    return (result.IsSuccess
                        && result.Value!.Outcome == RedeemOutcome.Reactivated
                        && result.Value!.MembershipId == subject.Id
                        && after.State == MembershipState.Active
                        && after.DisplayName == freshName.Trim()
                        && after.Role == SquadRole.Member
                        && noSecondMembership
                        && store.SaveCallCount == 1).ToProperty();
                }

                // Every other resolution leaves the membership Inactive with nothing persisted.
                SquadErrorCode expectedCode = resolution == Resolution.SupplyInvalidName
                    ? SquadErrorCode.ValidationFailed
                    : SquadErrorCode.DisplayNameInUse;

                return (!result.IsSuccess
                    && result.Error!.Code == expectedCode
                    && after.State == MembershipState.Inactive
                    && after.DisplayName == CollisionName
                    && noSecondMembership
                    && store.SaveCallCount == 0).ToProperty();
            });

    // ----- Unit tests: the new-join unique-display-name path (Requirements 11.7, 11.8) -----

    [Fact]
    [Trait("Property", "19")]
    public async Task Join_WithSuppliedNameCollidingWithExistingMember_IsRejectedAndAddsNoMembership()
    {
        var clock = new SquadFakeClock(Anchor);
        var secrets = new FakeInviteSecretService();
        (SquadStore store, Guid squadId) = SeedSquadWithInvite(secrets, clock);

        store.AddCommittedMembership(SquadMembership.CreateRegistered(squadId, Guid.NewGuid(), "Taken").Value!);
        int countBefore = store.Memberships.Count;

        Guid joiningUserId = Guid.NewGuid();
        store.AddUser(User.Create("Newcomer", "newcomer@example.test"));

        Result<RedeemInviteResult> result = await BuildHandler(store, secrets, clock)
            .HandleAsync(new RedeemInviteCommand(joiningUserId, PresentedSecret, "  taken  "), CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Equal(SquadErrorCode.DisplayNameInUse, result.Error!.Code);
        Assert.Equal(countBefore, store.Memberships.Count);
        Assert.Equal(0, store.SaveCallCount);
    }

    [Fact]
    [Trait("Property", "18")]
    public async Task Join_WithNoSuppliedName_DerivesUniqueNameFromIdentityAndCreatesMember()
    {
        var clock = new SquadFakeClock(Anchor);
        var secrets = new FakeInviteSecretService();
        (SquadStore store, Guid squadId) = SeedSquadWithInvite(secrets, clock);

        User user = User.Create("Fresh Face", "fresh@example.test");
        store.AddUser(user);
        Guid joiningUserId = user.Id;

        Result<RedeemInviteResult> result = await BuildHandler(store, secrets, clock)
            .HandleAsync(new RedeemInviteCommand(joiningUserId, PresentedSecret), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(RedeemOutcome.Joined, result.Value!.Outcome);
        SquadMembership created = Assert.Single(store.Memberships);
        Assert.Equal("Fresh Face", created.DisplayName);
        Assert.Equal(SquadRole.Member, created.Role);
        Assert.Equal(MembershipState.Active, created.State);
        Assert.Equal(joiningUserId, created.UserId);
        Assert.Equal(1, store.SaveCallCount);
    }

    /// <summary>Seeds a committed squad and a redeemable invite whose token hash matches the presented secret.</summary>
    private static (SquadStore store, Guid squadId) SeedSquadWithInvite(FakeInviteSecretService secrets, TimeProvider clock)
    {
        var store = new SquadStore();
        Squad squad = Squad.Create("The Squad").Value!;
        store.AddCommittedSquad(squad);

        Invite invite = Invite.Create(squad.Id, secrets.Hash(PresentedSecret), clock.GetUtcNow() + TimeSpan.FromDays(30));
        store.AddCommittedInvite(invite);
        return (store, squad.Id);
    }

    /// <summary>Builds the handler over the supplied store, secret service, and clock.</summary>
    private static RedeemInviteHandler BuildHandler(SquadStore store, FakeInviteSecretService secrets, TimeProvider clock) =>
        new(
            new FakeInviteRepository(store, clock),
            new FakeSquadMembershipRepository(store),
            new FakeUserRepository(store),
            secrets,
            new FakeSquadUnitOfWork(store),
            clock);

    /// <summary>Builds the user's existing membership in the requested starting state.</summary>
    private static SquadMembership BuildExisting(Guid squadId, Guid userId, StartState state)
    {
        switch (state)
        {
            case StartState.InactiveMember:
            {
                SquadMembership m = SquadMembership.CreateRegistered(squadId, userId, "Returner").Value!;
                m.Deactivate();
                return m;
            }

            case StartState.InactiveAdmin:
            {
                SquadMembership m = SquadMembership.CreateRegistered(squadId, userId, "Returner").Value!;
                m.PromoteToAdmin();
                m.Deactivate();
                return m;
            }

            case StartState.InactiveOwner:
            {
                SquadMembership m = SquadMembership.CreateOwner(squadId, userId, "Returner").Value!;
                m.Deactivate();
                return m;
            }

            case StartState.ActiveMember:
                return SquadMembership.CreateRegistered(squadId, userId, "Returner").Value!;

            case StartState.ActiveAdmin:
            {
                SquadMembership m = SquadMembership.CreateRegistered(squadId, userId, "Returner").Value!;
                m.PromoteToAdmin();
                return m;
            }

            case StartState.ActiveOwner:
                return SquadMembership.CreateOwner(squadId, userId, "Returner").Value!;

            default:
                throw new ArgumentOutOfRangeException(nameof(state), state, "Unhandled start state.");
        }
    }

    /// <summary>
    /// A valid replacement display name (trimmed length 1..50, optionally space-decorated) that does
    /// not, after trimming and case-insensitive comparison, collide with the <see cref="CollisionName"/>.
    /// </summary>
    private static Gen<string> FreshNameGen() =>
        from length in Gen.Choose(1, 40)
        from chars in ListOfLength(length, Gen.Elements(Alphabet))
        from lead in Gen.Choose(0, 2)
        from trail in Gen.Choose(0, 2)
        let core = new string(chars.ToArray())
        let distinct = string.Equals(core, CollisionName, StringComparison.OrdinalIgnoreCase) ? core + "x" : core
        select new string(' ', lead) + distinct + new string(' ', trail);

    /// <summary>An invalid display name: empty/whitespace, or longer than the 50-character maximum.</summary>
    private static Gen<string> InvalidNameGen() =>
        Gen.Elements("", "   ", new string('x', SquadMembership.DisplayNameMaxLength + 1));

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
