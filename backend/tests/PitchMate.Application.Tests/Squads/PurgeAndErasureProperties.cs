using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Application.Squads.UseCases;
using PitchMate.Domain.Squads;
using DomainResult = PitchMate.Domain.Squads.Result;

namespace PitchMate.Application.Tests.Squads;

/// <summary>
/// Property-based tests for the squad-lifecycle erasure use cases <see cref="PurgeSquadHandler"/>,
/// <see cref="EraseMembershipHandler"/>, and <see cref="OnUserErasedHandler"/> (squads-and-membership
/// design Properties 37, 38, and 39). They drive the real handlers against the in-memory squad fakes
/// and a controllable <see cref="ConfigurableMembershipHistoryProbe"/> (no database), per the
/// Application-layer testing strategy; the atomicity/DB-invariant portion of Property 38 runs against
/// Testcontainers PostgreSQL under task 18.5. The anonymise-vs-remove branch is driven by the
/// configurable history probe so both outcomes are exercised. Each property runs at least 100
/// iterations.
/// </summary>
[Trait("Feature", "squads-and-membership")]
public class PurgeAndErasureProperties
{
    /// <summary>A fixed UTC anchor the fake clock reads from for purge-due selection.</summary>
    private static readonly DateTimeOffset Anchor = new(2025, 1, 1, 12, 0, 0, TimeSpan.Zero);

    // Feature: squads-and-membership, Property 37: Purge removes the squad, anonymising history-bearing
    // memberships - for any soft-deleted squad once the clock reaches or passes its purge instant, the
    // squad and its memberships are permanently removed, except that each membership carrying match
    // history is anonymised (de-identified) and retained rather than removed. A soft-deleted squad
    // whose purge instant is still in the future is not touched.
    // Validates: Requirements 17.5, 18.1, 18.2, 18.7
    [Property(MaxTest = 200)]
    [Trait("Property", "37")]
    public Property Property37_PurgeRemovesSquadAnonymisingHistoryBearing() =>
        Prop.ForAll(
            Arb.From(HistoryFlagsGen(1, 6)),
            historyFlags =>
            {
                var clock = new SquadFakeClock(Anchor);
                var store = new SquadStore();
                var probe = new ConfigurableMembershipHistoryProbe();

                // A due squad: soft-deleted with a purge instant already reached.
                Squad due = Squad.Create("Due Squad").Value!;
                due.MarkForDeletion(Anchor.AddDays(-1));
                store.AddCommittedSquad(due, softDeleted: true);

                var dueMemberships = new List<(Guid Id, bool HasHistory)>();
                for (int i = 0; i < historyFlags.Count; i++)
                {
                    SquadMembership member =
                        SquadMembership.CreateRegistered(due.Id, Guid.NewGuid(), $"DueMember{i}").Value!;
                    store.AddCommittedMembership(member);
                    probe.SetHasHistory(member.Id, historyFlags[i]);
                    dueMemberships.Add((member.Id, historyFlags[i]));
                }

                // A soft-deleted squad whose purge instant is still in the future: must be untouched.
                Squad notDue = Squad.Create("Not Due Squad").Value!;
                notDue.MarkForDeletion(Anchor.AddDays(10));
                store.AddCommittedSquad(notDue, softDeleted: true);

                SquadMembership notDueHistory =
                    SquadMembership.CreateRegistered(notDue.Id, Guid.NewGuid(), "SurvivorHistory").Value!;
                store.AddCommittedMembership(notDueHistory);
                probe.SetHasHistory(notDueHistory.Id, hasHistory: true);

                SquadMembership notDueNoHistory =
                    SquadMembership.CreateRegistered(notDue.Id, Guid.NewGuid(), "SurvivorNoHistory").Value!;
                store.AddCommittedMembership(notDueNoHistory);

                var handler = new PurgeSquadHandler(
                    new FakeSquadRepository(store),
                    new FakeSquadMembershipRepository(store),
                    probe,
                    new FakeSquadUnitOfWork(store),
                    clock);

                Result<int> result = handler.HandleAsync(CancellationToken.None).GetAwaiter().GetResult();

                // Exactly the one due squad was purged and its row permanently removed.
                bool dueSquadPurged = result.IsSuccess
                    && result.Value == 1
                    && !store.Squads.ContainsKey(due.Id);

                // History-bearing due memberships are anonymised and retained; the rest are removed.
                bool membershipsHandled = dueMemberships.All(m =>
                {
                    SquadMembership? after = store.FindMembershipById(m.Id);
                    if (m.HasHistory)
                    {
                        return after is not null
                            && after.DisplayName == SquadMembership.DisplayNamePlaceholder
                            && after.DisplayNameNormalized is null
                            && after.UserId is null;
                    }

                    return after is null;
                });

                // The not-yet-due squad and both its memberships are left entirely untouched.
                SquadMembership? survivorHistory = store.FindMembershipById(notDueHistory.Id);
                SquadMembership? survivorNoHistory = store.FindMembershipById(notDueNoHistory.Id);
                bool notDueUntouched = store.Squads.ContainsKey(notDue.Id)
                    && survivorHistory is not null
                    && survivorHistory.DisplayName == "SurvivorHistory"
                    && survivorHistory.UserId is not null
                    && survivorNoHistory is not null
                    && survivorNoHistory.DisplayName == "SurvivorNoHistory";

                return (dueSquadPurged && membershipsHandled && notDueUntouched).ToProperty();
            });

    // Feature: squads-and-membership, Property 38: Erasure anonymises history-bearing memberships and
    // removes the rest - for any single membership being erased, if it carries match history its
    // display name is replaced with the fixed placeholder, its backing user reference is cleared, and
    // the de-identified row (exempt from the uniqueness rule) is retained; if it carries no history the
    // row is permanently removed.
    // Validates: Requirements 18.1, 18.2
    [Property(MaxTest = 200)]
    [Trait("Property", "38")]
    public Property Property38_EraseMembershipAnonymisesOrRemoves() =>
        Prop.ForAll(
            Arb.From(Gen.Elements(true, false)),
            Arb.From(Gen.Elements(true, false)),
            (hasHistory, targetIsGuest) =>
            {
                var store = new SquadStore();
                var probe = new ConfigurableMembershipHistoryProbe();

                Squad squad = Squad.Create("The Squad").Value!;
                store.AddCommittedSquad(squad);

                // The erasure target is a non-owner (a registered Member or a guest), so the owner
                // guard never applies here; the owner constraint is exercised by Property 39.
                SquadMembership target = targetIsGuest
                    ? SquadMembership.CreateGuest(squad.Id, "Target", skillTier: null, Anchor).Value!
                    : SquadMembership.CreateRegistered(squad.Id, Guid.NewGuid(), "Target").Value!;
                store.AddCommittedMembership(target);
                probe.SetHasHistory(target.Id, hasHistory);

                var handler = BuildEraseHandler(store, probe);

                DomainResult result = handler
                    .HandleAsync(new EraseMembershipCommand(target.Id), CancellationToken.None)
                    .GetAwaiter()
                    .GetResult();

                SquadMembership? after = store.FindMembershipById(target.Id);

                if (hasHistory)
                {
                    // Anonymised and retained: placeholder name, uniqueness-exempt, user reference cleared.
                    return (result.IsSuccess
                        && after is not null
                        && after.DisplayName == SquadMembership.DisplayNamePlaceholder
                        && after.DisplayNameNormalized is null
                        && after.UserId is null).ToProperty();
                }

                // No history: the row is permanently removed.
                return (result.IsSuccess && after is null).ToProperty();
            });

    // Feature: squads-and-membership, Property 38: Erasure anonymises history-bearing memberships and
    // removes the rest - when a user is erased, the anonymise-vs-remove rule is applied to each of that
    // user's memberships: every history-bearing membership is anonymised with its user reference
    // cleared and retained, and every membership with no history is permanently removed.
    // Validates: Requirements 18.3, 18.4
    [Property(MaxTest = 200)]
    [Trait("Property", "38")]
    public Property Property38_UserErasureAppliesRuleToEachMembership() =>
        Prop.ForAll(
            Arb.From(HistoryFlagsGen(1, 6)),
            historyFlags =>
            {
                var store = new SquadStore();
                var probe = new ConfigurableMembershipHistoryProbe();
                Guid userId = Guid.NewGuid();

                var memberships = new List<(Guid Id, bool HasHistory)>();
                for (int i = 0; i < historyFlags.Count; i++)
                {
                    // Each membership backs the same user in a distinct squad, as a non-owner Member so
                    // the owner guard does not apply (that guard is exercised by Property 39).
                    Squad squad = Squad.Create($"Squad {i}").Value!;
                    store.AddCommittedSquad(squad);

                    SquadMembership member =
                        SquadMembership.CreateRegistered(squad.Id, userId, $"Member{i}").Value!;
                    store.AddCommittedMembership(member);
                    probe.SetHasHistory(member.Id, historyFlags[i]);
                    memberships.Add((member.Id, historyFlags[i]));
                }

                var handler = new OnUserErasedHandler(
                    new FakeSquadMembershipRepository(store),
                    new FakeSquadRepository(store),
                    probe,
                    new FakeSquadUnitOfWork(store));

                DomainResult result = handler
                    .HandleAsync(new OnUserErasedCommand(userId), CancellationToken.None)
                    .GetAwaiter()
                    .GetResult();

                bool eachMembershipHandled = memberships.All(m =>
                {
                    SquadMembership? after = store.FindMembershipById(m.Id);
                    if (m.HasHistory)
                    {
                        return after is not null
                            && after.DisplayName == SquadMembership.DisplayNamePlaceholder
                            && after.UserId is null;
                    }

                    return after is null;
                });

                return (result.IsSuccess && eachMembershipHandled).ToProperty();
            });

    // Feature: squads-and-membership, Property 39: Erasing an owner requires prior ownership transfer -
    // for any erasure of an Owner membership of a squad that is not being deleted, the erasure is
    // rejected with OwnerConstraint and the membership is left unchanged (still role Owner) until
    // ownership has been transferred to another registered membership; the squad is never left without
    // an owner. Once ownership has transferred, the erasure of the former owner proceeds.
    // Validates: Requirements 18.5, 18.6
    [Property(MaxTest = 200)]
    [Trait("Property", "39")]
    public Property Property39_ErasingOwnerRequiresPriorOwnershipTransfer() =>
        Prop.ForAll(
            Arb.From(Gen.Elements(true, false)),
            Arb.From(Gen.Elements(true, false)),
            (hasHistory, transferFirst) =>
            {
                var store = new SquadStore();
                var probe = new ConfigurableMembershipHistoryProbe();

                // A live squad (not pending deletion) with an owner and a registered member to
                // transfer ownership to.
                Squad squad = Squad.Create("The Squad").Value!;
                store.AddCommittedSquad(squad);

                SquadMembership owner =
                    SquadMembership.CreateOwner(squad.Id, Guid.NewGuid(), "Owner").Value!;
                store.AddCommittedMembership(owner);
                probe.SetHasHistory(owner.Id, hasHistory);

                SquadMembership successor =
                    SquadMembership.CreateRegistered(squad.Id, Guid.NewGuid(), "Successor").Value!;
                store.AddCommittedMembership(successor);

                if (transferFirst)
                {
                    // An atomic owner/admin swap moves ownership to the successor.
                    owner.StepDownToAdmin();
                    successor.AssignOwner();
                }

                var handler = BuildEraseHandler(store, probe);

                DomainResult result = handler
                    .HandleAsync(new EraseMembershipCommand(owner.Id), CancellationToken.None)
                    .GetAwaiter()
                    .GetResult();

                if (!transferFirst)
                {
                    // Rejected with OwnerConstraint; the owner is unchanged and the squad still has an owner.
                    SquadMembership? after = store.FindMembershipById(owner.Id);
                    return (!result.IsSuccess
                        && result.Error!.Code == SquadErrorCode.OwnerConstraint
                        && after is not null
                        && after.Role == SquadRole.Owner
                        && after.DisplayName == "Owner"
                        && after.UserId is not null).ToProperty();
                }

                // Ownership transferred first: the erasure of the former owner proceeds, and the
                // successor now holds the owner role so the squad is never left without an owner.
                SquadMembership? formerOwner = store.FindMembershipById(owner.Id);
                bool successorIsOwner = store.FindMembershipById(successor.Id)?.Role == SquadRole.Owner;

                if (hasHistory)
                {
                    return (result.IsSuccess
                        && successorIsOwner
                        && formerOwner is not null
                        && formerOwner.DisplayName == SquadMembership.DisplayNamePlaceholder
                        && formerOwner.UserId is null
                        && formerOwner.Role is null).ToProperty();
                }

                return (result.IsSuccess && successorIsOwner && formerOwner is null).ToProperty();
            });

    /// <summary>Builds an <see cref="EraseMembershipHandler"/> over the supplied store and history probe.</summary>
    private static EraseMembershipHandler BuildEraseHandler(SquadStore store, IMembershipHistoryProbe probe) =>
        new(
            new FakeSquadMembershipRepository(store),
            new FakeSquadRepository(store),
            probe,
            new FakeSquadUnitOfWork(store));

    /// <summary>
    /// Generates a non-empty list of <paramref name="min"/>..<paramref name="max"/> match-history flags,
    /// one per membership, spanning both the anonymise (history present) and remove (no history) branches.
    /// </summary>
    private static Gen<List<bool>> HistoryFlagsGen(int min, int max) =>
        from count in Gen.Choose(min, max)
        from flags in Gen.ListOf(Gen.Elements(true, false), count)
        select flags.ToList();
}

/// <summary>
/// A controllable <see cref="IMembershipHistoryProbe"/> whose per-membership answer is set explicitly,
/// so erasure/purge tests can drive both the anonymise (history present) and remove (no history)
/// branches deterministically. Unset memberships report no history, mirroring the conservative default
/// the Infrastructure spec registers until match tables exist.
/// </summary>
internal sealed class ConfigurableMembershipHistoryProbe : IMembershipHistoryProbe
{
    private readonly HashSet<Guid> _withHistory = new();

    /// <summary>Records whether <paramref name="membershipId"/> carries at least one match-history link.</summary>
    public void SetHasHistory(Guid membershipId, bool hasHistory)
    {
        if (hasHistory)
        {
            _withHistory.Add(membershipId);
        }
        else
        {
            _withHistory.Remove(membershipId);
        }
    }

    public Task<bool> HasMatchHistoryAsync(Guid membershipId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(_withHistory.Contains(membershipId));
    }
}
