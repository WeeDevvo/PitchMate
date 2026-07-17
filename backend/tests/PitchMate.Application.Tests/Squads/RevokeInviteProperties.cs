using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Application.Squads.UseCases;
using PitchMate.Domain.Squads;
using DomainResult = PitchMate.Domain.Squads.Result;

namespace PitchMate.Application.Tests.Squads;

/// <summary>
/// Property-based tests for <see cref="RevokeInviteHandler"/> (squads-and-membership design
/// Property 27). They drive the real handler against the in-memory squad fakes and a controllable
/// clock (no database), per the Application-layer testing strategy. Over generated actor roles/states,
/// invite states, and clock instants the properties assert that revocation is authorised (only an
/// active owner or admin of the invite's squad may revoke), idempotent against the clock (an
/// already-<c>Revoked</c> or derived-<c>Expired</c> invite is an unchanged no-op success, and a second
/// revoke of an <c>Active</c> invite is likewise a no-op), and never mutates any membership in the
/// squad. Each property runs at least 100 iterations.
/// </summary>
[Trait("Feature", "squads-and-membership")]
public class RevokeInviteProperties
{
    /// <summary>A fixed UTC anchor the fake clock reads from unless a property generates its own instant.</summary>
    private static readonly DateTimeOffset Anchor = new(2025, 1, 1, 12, 0, 0, TimeSpan.Zero);

    /// <summary>The distinct kinds of actor the revoke command's acting user can resolve to.</summary>
    public enum ActorKind
    {
        ActiveOwner,
        ActiveAdmin,
        ActiveMember,
        InactiveOwner,
        InactiveAdmin,
        InactiveMember,
        NonMember,
        ForeignAdmin
    }

    /// <summary>The distinct kinds of invite a revocation can target.</summary>
    public enum InviteKind
    {
        ActiveExpiring,
        ActiveNonExpiring,
        Revoked,
        Expired,
        ForeignActive
    }

    // Feature: squads-and-membership, Property 27: Revocation is authorised, idempotent, and does not
    // affect existing members - only an active owner or admin of the invite's squad may revoke; a
    // revocation of an effectively-Active invite sets its stored state to Revoked and reports success,
    // while a revocation of an already-Revoked or derived-Expired invite leaves the stored state
    // unchanged and still reports success; every unauthorised actor (member, inactive membership,
    // non-member, foreign-squad admin) and every foreign-squad invite is rejected with the uniform
    // authorisation failure and leaves the invite's stored state unchanged; and in every case every
    // membership in the squad is left exactly as it was.
    // Validates: Requirements 12.1, 12.4, 12.5
    [Property(MaxTest = 300)]
    [Trait("Property", "27")]
    public Property Property27_RevocationIsAuthorisedIdempotentAndMembersUnaffected() =>
        Prop.ForAll(
            Arb.From(Gen.Elements(Enum.GetValues<ActorKind>())),
            Arb.From(Gen.Elements(Enum.GetValues<InviteKind>())),
            Arb.From(NowGen()),
            (actorKind, inviteKind, now) =>
            {
                var clock = new SquadFakeClock(now);
                var store = new SquadStore();

                Squad squad = Squad.Create("The Squad").Value!;
                store.AddCommittedSquad(squad);

                Guid actingUserId = SeedActor(store, squad.Id, actorKind);

                // Bystander memberships in the squad that must never be touched by a revocation
                // (Requirement 12.5 - existing members created through the invite are unaffected).
                var bystanders = new List<SquadMembership>
                {
                    SquadMembership.CreateRegistered(squad.Id, Guid.NewGuid(), "Member A").Value!,
                    Admin(squad.Id, "Admin B"),
                    SquadMembership.CreateGuest(squad.Id, "Guest C", skillTier: null, now).Value!,
                    Inactive(SquadMembership.CreateRegistered(squad.Id, Guid.NewGuid(), "Left D").Value!),
                };
                foreach (SquadMembership bystander in bystanders)
                {
                    store.AddCommittedMembership(bystander);
                }

                var membershipSnapshots = store.Memberships
                    .Select(m => (m.Id, m.Role, m.State, m.DisplayName))
                    .ToList();

                (Invite invite, bool belongsToSquad) = SeedInvite(store, squad.Id, inviteKind, now);

                // Capture the pre-revocation facts: revoking mutates the invite, so the effective
                // state must be read before invoking the handler, not after.
                InviteState storedStateBefore = invite.State;
                bool effectivelyActive = invite.EffectiveState(now) == InviteState.Active;

                DomainResult result = new RevokeInviteHandler(
                        new FakeSquadMembershipRepository(store),
                        new FakeInviteRepository(store, clock),
                        new FakeSquadUnitOfWork(store),
                        clock)
                    .HandleAsync(new RevokeInviteCommand(actingUserId, squad.Id, invite.Id), CancellationToken.None)
                    .GetAwaiter()
                    .GetResult();

                bool actorAuthorised = actorKind is ActorKind.ActiveOwner or ActorKind.ActiveAdmin;

                // Memberships are never mutated by a revocation, whatever the outcome.
                bool membershipsUnchanged = membershipSnapshots.All(s =>
                {
                    SquadMembership current = store.FindMembershipById(s.Id)!;
                    return current.Role == s.Role
                        && current.State == s.State
                        && current.DisplayName == s.DisplayName;
                });

                bool outcomeCorrect;
                if (!actorAuthorised || !belongsToSquad)
                {
                    // Unauthorised actor, or a foreign-squad invite: uniform failure, no write, and the
                    // invite's stored state is left unchanged (Requirement 12.7 / gate; state preserved).
                    outcomeCorrect = !result.IsSuccess
                        && result.Error!.Code == SquadErrorCode.Unauthorized
                        && invite.State == storedStateBefore
                        && store.SaveCallCount == 0;
                }
                else if (effectivelyActive)
                {
                    // Authorised revoke of an effectively-Active invite: transitions to Revoked and commits once.
                    outcomeCorrect = result.IsSuccess
                        && invite.State == InviteState.Revoked
                        && store.SaveCallCount == 1;
                }
                else
                {
                    // Authorised revoke of an already-Revoked or derived-Expired invite: idempotent no-op success.
                    outcomeCorrect = result.IsSuccess
                        && invite.State == storedStateBefore
                        && store.SaveCallCount == 0;
                }

                return (outcomeCorrect && membershipsUnchanged).ToProperty();
            });

    // Feature: squads-and-membership, Property 27: Revocation is idempotent - revoking an Active invite
    // transitions it to Revoked with a single commit, and an immediate second revoke by an authorised
    // owner is a no-op success that leaves the stored state Revoked and performs no further write, while
    // every membership in the squad stays unchanged throughout.
    // Validates: Requirements 12.1, 12.4, 12.5
    [Property(MaxTest = 200)]
    [Trait("Property", "27")]
    public Property Property27_SecondRevokeOfActiveInviteIsNoOp() =>
        Prop.ForAll(
            Arb.From(Gen.Elements(true, false)),
            Arb.From(NowGen()),
            (nonExpiring, now) =>
            {
                var clock = new SquadFakeClock(now);
                var store = new SquadStore();

                Squad squad = Squad.Create("The Squad").Value!;
                store.AddCommittedSquad(squad);

                Guid actingUserId = SeedActor(store, squad.Id, ActorKind.ActiveOwner);

                var member = SquadMembership.CreateRegistered(squad.Id, Guid.NewGuid(), "Member A").Value!;
                store.AddCommittedMembership(member);
                var memberSnapshot = (member.Role, member.State, member.DisplayName);

                DateTimeOffset? expiresAt = nonExpiring ? null : now + TimeSpan.FromDays(30);
                Invite invite = Invite.Create(squad.Id, "seed-hash", expiresAt);
                store.AddCommittedInvite(invite);

                var handler = new RevokeInviteHandler(
                    new FakeSquadMembershipRepository(store),
                    new FakeInviteRepository(store, clock),
                    new FakeSquadUnitOfWork(store),
                    clock);
                var command = new RevokeInviteCommand(actingUserId, squad.Id, invite.Id);

                DomainResult first = handler.HandleAsync(command, CancellationToken.None).GetAwaiter().GetResult();
                bool firstRevoked = first.IsSuccess
                    && invite.State == InviteState.Revoked
                    && store.SaveCallCount == 1;

                DomainResult second = handler.HandleAsync(command, CancellationToken.None).GetAwaiter().GetResult();
                bool secondIsNoOp = second.IsSuccess
                    && invite.State == InviteState.Revoked
                    && store.SaveCallCount == 1; // no additional write

                SquadMembership currentMember = store.FindMembershipById(member.Id)!;
                bool memberUnchanged = currentMember.Role == memberSnapshot.Role
                    && currentMember.State == memberSnapshot.State
                    && currentMember.DisplayName == memberSnapshot.DisplayName;

                return (firstRevoked && secondIsNoOp && memberUnchanged).ToProperty();
            });

    /// <summary>
    /// Seeds the acting membership for the requested kind and returns the acting user identity to drive
    /// the command with. A base active owner is added whenever the actor is not itself the owner so the
    /// squad remains well-formed; a <see cref="ActorKind.NonMember"/> resolves to no membership and a
    /// <see cref="ActorKind.ForeignAdmin"/> is an admin of a different squad, so neither resolves for
    /// the target squad.
    /// </summary>
    private static Guid SeedActor(SquadStore store, Guid squadId, ActorKind kind)
    {
        switch (kind)
        {
            case ActorKind.ActiveOwner:
            {
                Guid userId = Guid.NewGuid();
                store.AddCommittedMembership(SquadMembership.CreateOwner(squadId, userId, "Owner").Value!);
                return userId;
            }

            case ActorKind.InactiveOwner:
            {
                Guid userId = Guid.NewGuid();
                SquadMembership owner = SquadMembership.CreateOwner(squadId, userId, "Owner").Value!;
                owner.Deactivate();
                store.AddCommittedMembership(owner);
                return userId;
            }

            case ActorKind.ActiveAdmin:
            {
                SeedBaseOwner(store, squadId);
                Guid userId = Guid.NewGuid();
                SquadMembership admin = SquadMembership.CreateRegistered(squadId, userId, "Admin").Value!;
                admin.PromoteToAdmin();
                store.AddCommittedMembership(admin);
                return userId;
            }

            case ActorKind.InactiveAdmin:
            {
                SeedBaseOwner(store, squadId);
                Guid userId = Guid.NewGuid();
                SquadMembership admin = SquadMembership.CreateRegistered(squadId, userId, "Admin").Value!;
                admin.PromoteToAdmin();
                admin.Deactivate();
                store.AddCommittedMembership(admin);
                return userId;
            }

            case ActorKind.ActiveMember:
            {
                SeedBaseOwner(store, squadId);
                Guid userId = Guid.NewGuid();
                store.AddCommittedMembership(SquadMembership.CreateRegistered(squadId, userId, "Member").Value!);
                return userId;
            }

            case ActorKind.InactiveMember:
            {
                SeedBaseOwner(store, squadId);
                Guid userId = Guid.NewGuid();
                SquadMembership member = SquadMembership.CreateRegistered(squadId, userId, "Member").Value!;
                member.Deactivate();
                store.AddCommittedMembership(member);
                return userId;
            }

            case ActorKind.NonMember:
                SeedBaseOwner(store, squadId);
                return Guid.NewGuid();

            case ActorKind.ForeignAdmin:
            {
                SeedBaseOwner(store, squadId);
                Guid userId = Guid.NewGuid();
                // An admin of a different squad: resolvable in that squad, but not the target squad.
                SquadMembership foreignAdmin = SquadMembership.CreateRegistered(Guid.NewGuid(), userId, "Elsewhere Admin").Value!;
                foreignAdmin.PromoteToAdmin();
                store.AddCommittedMembership(foreignAdmin);
                return userId;
            }

            default:
                throw new ArgumentOutOfRangeException(nameof(kind), kind, "Unhandled actor kind.");
        }
    }

    /// <summary>Adds a base active owner to the squad so it remains well-formed when the actor is not the owner.</summary>
    private static void SeedBaseOwner(SquadStore store, Guid squadId) =>
        store.AddCommittedMembership(SquadMembership.CreateOwner(squadId, Guid.NewGuid(), "Owner").Value!);

    /// <summary>
    /// Seeds the target invite for the requested kind against the clock instant <paramref name="now"/>,
    /// returning the invite and whether it belongs to <paramref name="squadId"/>.
    /// </summary>
    private static (Invite invite, bool belongsToSquad) SeedInvite(SquadStore store, Guid squadId, InviteKind kind, DateTimeOffset now)
    {
        switch (kind)
        {
            case InviteKind.ActiveExpiring:
            {
                Invite invite = Invite.Create(squadId, "hash-active", now + TimeSpan.FromDays(30));
                store.AddCommittedInvite(invite);
                return (invite, true);
            }

            case InviteKind.ActiveNonExpiring:
            {
                Invite invite = Invite.Create(squadId, "hash-nonexpiring", expiresAt: null);
                store.AddCommittedInvite(invite);
                return (invite, true);
            }

            case InviteKind.Revoked:
            {
                Invite invite = Invite.Create(squadId, "hash-revoked", now + TimeSpan.FromDays(30));
                invite.Revoke();
                store.AddCommittedInvite(invite);
                return (invite, true);
            }

            case InviteKind.Expired:
            {
                // Stored state stays Active; the past expiry makes the effective state Expired.
                Invite invite = Invite.Create(squadId, "hash-expired", now - TimeSpan.FromHours(1));
                store.AddCommittedInvite(invite);
                return (invite, true);
            }

            case InviteKind.ForeignActive:
            {
                Invite invite = Invite.Create(Guid.NewGuid(), "hash-foreign", now + TimeSpan.FromDays(30));
                store.AddCommittedInvite(invite);
                return (invite, false);
            }

            default:
                throw new ArgumentOutOfRangeException(nameof(kind), kind, "Unhandled invite kind.");
        }
    }

    private static SquadMembership Admin(Guid squadId, string name)
    {
        SquadMembership member = SquadMembership.CreateRegistered(squadId, Guid.NewGuid(), name).Value!;
        member.PromoteToAdmin();
        return member;
    }

    private static SquadMembership Inactive(SquadMembership membership)
    {
        membership.Deactivate();
        return membership;
    }

    /// <summary>A UTC clock instant within a bounded window around the anchor.</summary>
    private static Gen<DateTimeOffset> NowGen() =>
        from minutes in Gen.Choose(-5_000_000, 5_000_000)
        select Anchor.AddMinutes(minutes);
}
