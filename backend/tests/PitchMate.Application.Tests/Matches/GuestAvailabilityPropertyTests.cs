using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using Microsoft.Extensions.Time.Testing;
using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Matches.UseCases;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Application.Tests.Squads;
using PitchMate.Domain.Matches;
using Result = PitchMate.Domain.Matches.Result;
using Squad = PitchMate.Domain.Squads.Squad;
using SquadMembership = PitchMate.Domain.Squads.SquadMembership;

namespace PitchMate.Application.Tests.Matches;

/// <summary>
/// Property-based tests for <see cref="SetGuestAvailabilityHandler"/> and
/// <see cref="ClearGuestAvailabilityHandler"/>, the writes an owner or admin uses to mark the days a
/// guest can play. They drive the real handlers against the shared squad fakes and an availability
/// fake that models the commit boundary.
/// <para>
/// The property: a write changes the guest's stored response <em>iff</em> the path squad is the
/// match's own, the actor is an active owner or admin, the target is an active guest of the match's
/// squad, and the match is gathering availability. The first unmet condition decides the failure:
/// the uniform <see cref="MatchErrorCode.Unauthorized"/> for the squad or actor,
/// <see cref="MatchErrorCode.ValidationFailed"/> for the target, then
/// <see cref="MatchErrorCode.InvalidState"/>. Any failure leaves every stored response as it was.
/// </para>
/// </summary>
[Trait("Feature", "match-lifecycle")]
public class GuestAvailabilityPropertyTests
{
    /// <summary>Who is asking.</summary>
    public enum ActorKind
    {
        Owner,
        Admin,
        InactiveAdmin,
        Member,
        Guest,
        NonMember,
    }

    /// <summary>Whom the write is for.</summary>
    public enum TargetKind
    {
        ActiveGuest,
        InactiveGuest,
        RegisteredMember,
        GuestOfAnotherSquad,
        Unknown,
    }

    /// <summary>Which write is made.</summary>
    public enum Operation
    {
        Set,
        Clear,
    }

    private static readonly DateTimeOffset Now = new(2025, 1, 1, 12, 0, 0, TimeSpan.Zero);

    private static readonly DateTimeOffset[] CandidateDays = [Now.AddDays(1), Now.AddDays(2), Now.AddDays(3)];

    /// <summary>The marking every target starts with, so an unchanged response is observable.</summary>
    private static readonly DateTimeOffset[] PriorMarking = [CandidateDays[0]];

    private static readonly Gen<(ActorKind, TargetKind, Operation, bool, bool, DateTimeOffset[])> ScenarioGen =
        from actor in Gen.Elements(Enum.GetValues<ActorKind>())
        from target in Gen.Elements(Enum.GetValues<TargetKind>())
        from operation in Gen.Elements(Enum.GetValues<Operation>())
        from gathering in Gen.Elements(true, false)
        from pathSquadMatches in Gen.Elements(true, false)
        from marked in Gen.SubListOf(CandidateDays)
        select (actor, target, operation, gathering, pathSquadMatches, marked.ToArray());

    [Property(MaxTest = 300)]
    public Property AGuestWriteSucceedsOnlyForAnOrganiserMarkingAnActiveGuestWhileGathering() =>
        Prop.ForAll(
            Arb.From(ScenarioGen),
            scenario =>
            {
                var (actor, target, operation, gathering, pathSquadMatches, marked) = scenario;
                var world = World.Create(actor, target, gathering);
                Guid pathSquad = pathSquadMatches ? world.SquadId : Guid.NewGuid();

                MatchErrorCode? failure = operation == Operation.Set
                    ? world.Set(pathSquad, marked).Error?.Code
                    : world.Clear(pathSquad).Error?.Code;

                MatchErrorCode? expected =
                    !pathSquadMatches || actor is not (ActorKind.Owner or ActorKind.Admin) ? MatchErrorCode.Unauthorized
                    : target != TargetKind.ActiveGuest ? MatchErrorCode.ValidationFailed
                    : !gathering ? MatchErrorCode.InvalidState
                    : null;

                IReadOnlyList<DateTimeOffset>? stored = world.StoredFor(world.TargetId);
                bool storedAsExpected = expected is not null
                    ? world.EveryResponseUnchanged()
                    : operation == Operation.Set
                        ? stored is not null && stored.Order().SequenceEqual(marked.Order())
                        : stored is null;

                return (failure == expected && storedAsExpected)
                    .Label($"expected {expected?.ToString() ?? "success"}, got {failure?.ToString() ?? "success"}; stored as expected: {storedAsExpected}");
            });

    // A registered member's own response is never touched by a guest write, even a successful one.
    [Fact]
    public void ASuccessfulGuestWrite_LeavesOtherResponsesAlone()
    {
        var world = World.Create(ActorKind.Owner, TargetKind.ActiveGuest, gathering: true);

        Result<SubmitAvailabilityResult> result = world.Set(world.SquadId, [CandidateDays[2]]);

        Assert.True(result.IsSuccess);
        Assert.Equal(world.TargetId, result.Value!.SquadMembershipId);
        Assert.Equal([CandidateDays[2]], world.StoredFor(world.TargetId));
        Assert.Equal(PriorMarking, world.StoredFor(world.BystanderId));
    }

    /// <summary>A squad, a match, an actor, a target and a bystander member, each with a prior marking.</summary>
    private sealed class World
    {
        private readonly SetGuestAvailabilityHandler _set;
        private readonly ClearGuestAvailabilityHandler _clear;
        private readonly CommitBoundaryAvailability _availability;
        private readonly Dictionary<Guid, DateTimeOffset[]> _initial;

        private World(
            SetGuestAvailabilityHandler set,
            ClearGuestAvailabilityHandler clear,
            CommitBoundaryAvailability availability,
            Guid actingUserId,
            Guid squadId,
            Guid matchId,
            Guid targetId,
            Guid bystanderId)
        {
            _set = set;
            _clear = clear;
            _availability = availability;
            _initial = availability.Snapshot();
            ActingUserId = actingUserId;
            SquadId = squadId;
            MatchId = matchId;
            TargetId = targetId;
            BystanderId = bystanderId;
        }

        public Guid ActingUserId { get; }

        public Guid SquadId { get; }

        public Guid MatchId { get; }

        public Guid TargetId { get; }

        public Guid BystanderId { get; }

        public static World Create(ActorKind actorKind, TargetKind targetKind, bool gathering)
        {
            var store = new SquadStore();
            Squad squad = Squad.Create("The Squad").Value!;
            Squad other = Squad.Create("Another Squad").Value!;
            store.AddCommittedSquad(squad);
            store.AddCommittedSquad(other);

            Guid actingUserId = Guid.NewGuid();
            SquadMembership? acting = actorKind switch
            {
                ActorKind.Owner => SquadMembership.CreateOwner(squad.Id, actingUserId, "Owner").Value!,
                ActorKind.Admin or ActorKind.InactiveAdmin => Admin(squad.Id, actingUserId, actorKind == ActorKind.InactiveAdmin),
                ActorKind.Member => SquadMembership.CreateRegistered(squad.Id, actingUserId, "Member").Value!,
                // A guest has no account; one resolved for the acting user models a forged lookup.
                ActorKind.Guest => SquadMembership.CreateGuest(squad.Id, "Acting Guest", skillTier: null, Now).Value!,
                _ => null,
            };

            if (acting is not null && actorKind != ActorKind.Guest)
            {
                store.AddCommittedMembership(acting);
            }

            SquadMembership? target = targetKind switch
            {
                TargetKind.ActiveGuest => SquadMembership.CreateGuest(squad.Id, "Guest", skillTier: null, Now).Value!,
                TargetKind.InactiveGuest => Inactive(SquadMembership.CreateGuest(squad.Id, "Gone Guest", skillTier: null, Now).Value!),
                TargetKind.RegisteredMember => SquadMembership.CreateRegistered(squad.Id, Guid.NewGuid(), "Registered").Value!,
                TargetKind.GuestOfAnotherSquad => SquadMembership.CreateGuest(other.Id, "Elsewhere", skillTier: null, Now).Value!,
                _ => null,
            };

            if (target is not null)
            {
                store.AddCommittedMembership(target);
            }

            SquadMembership bystander = SquadMembership.CreateRegistered(squad.Id, Guid.NewGuid(), "Bystander").Value!;
            store.AddCommittedMembership(bystander);

            Match match = Match.CreateDraft(Guid.NewGuid(), squad.Id, "Recreation Ground", CandidateDays, Now).Value!;
            Guid targetId = target?.Id ?? Guid.NewGuid();

            var availability = new CommitBoundaryAvailability();
            foreach (Guid membershipId in new[] { targetId, bystander.Id })
            {
                availability.Seed(match.SubmitAvailability(membershipId, PriorMarking, Now).Value!);
            }

            if (!gathering)
            {
                match.Confirm(CandidateDays[0], activeMembers: []);
            }

            var memberships = actorKind == ActorKind.Guest
                ? new GuestActorMemberships(new FakeSquadMembershipRepository(store), actingUserId, acting!)
                : (ISquadMembershipRepository)new FakeSquadMembershipRepository(store);
            var matches = new SingleMatchRepository(match);
            var unitOfWork = new CommittingUnitOfWork(availability);

            return new World(
                new SetGuestAvailabilityHandler(matches, memberships, availability, unitOfWork, new FakeTimeProvider(Now)),
                new ClearGuestAvailabilityHandler(matches, memberships, availability, unitOfWork),
                availability,
                actingUserId,
                squad.Id,
                match.Id,
                targetId,
                bystander.Id);
        }

        public Result<SubmitAvailabilityResult> Set(Guid pathSquad, DateTimeOffset[] marked) =>
            _set.HandleAsync(
                new SetGuestAvailabilityCommand(ActingUserId, pathSquad, MatchId, TargetId, marked),
                CancellationToken.None).GetAwaiter().GetResult();

        public Result Clear(Guid pathSquad) =>
            _clear.HandleAsync(
                new ClearGuestAvailabilityCommand(ActingUserId, pathSquad, MatchId, TargetId),
                CancellationToken.None).GetAwaiter().GetResult();

        public IReadOnlyList<DateTimeOffset>? StoredFor(Guid membershipId) =>
            _availability.Snapshot().GetValueOrDefault(membershipId);

        public bool EveryResponseUnchanged()
        {
            Dictionary<Guid, DateTimeOffset[]> now = _availability.Snapshot();
            return now.Count == _initial.Count
                && _initial.All(entry => now.TryGetValue(entry.Key, out var days) && days.SequenceEqual(entry.Value));
        }

        private static SquadMembership Admin(Guid squadId, Guid userId, bool inactive)
        {
            SquadMembership admin = SquadMembership.CreateRegistered(squadId, userId, "Admin").Value!;
            admin.PromoteToAdmin();
            return inactive ? Inactive(admin) : admin;
        }

        private static SquadMembership Inactive(SquadMembership membership)
        {
            membership.Deactivate();
            return membership;
        }
    }

    /// <summary>Resolves a guest membership for the acting user, which no real lookup can do; otherwise delegates.</summary>
    private sealed class GuestActorMemberships(FakeSquadMembershipRepository inner, Guid userId, SquadMembership guest)
        : ISquadMembershipRepository
    {
        public Task<SquadMembership?> GetByUserAndSquadAsync(Guid actingUserId, Guid squadId, CancellationToken cancellationToken) =>
            actingUserId == userId && squadId == guest.SquadId
                ? Task.FromResult<SquadMembership?>(guest)
                : inner.GetByUserAndSquadAsync(actingUserId, squadId, cancellationToken);

        public Task AddAsync(SquadMembership membership, CancellationToken cancellationToken) =>
            inner.AddAsync(membership, cancellationToken);

        public Task<SquadMembership?> GetByIdAsync(Guid membershipId, CancellationToken cancellationToken) =>
            inner.GetByIdAsync(membershipId, cancellationToken);

        public Task<IReadOnlyList<SquadMembership>> ListForSquadAsync(Guid squadId, bool activeOnly, CancellationToken cancellationToken) =>
            inner.ListForSquadAsync(squadId, activeOnly, cancellationToken);

        public Task<SquadMembership?> GetOwnerAsync(Guid squadId, CancellationToken cancellationToken) =>
            inner.GetOwnerAsync(squadId, cancellationToken);

        public Task<bool> IsSquadPendingDeletionAsync(Guid squadId, CancellationToken cancellationToken) =>
            inner.IsSquadPendingDeletionAsync(squadId, cancellationToken);

        public Task<bool> DisplayNameTakenAsync(Guid squadId, string normalisedName, Guid? excludingMembershipId, CancellationToken cancellationToken) =>
            inner.DisplayNameTakenAsync(squadId, normalisedName, excludingMembershipId, cancellationToken);

        public Task<IReadOnlyList<SquadMembership>> ListForUserAsync(Guid actingUserId, CancellationToken cancellationToken) =>
            inner.ListForUserAsync(actingUserId, cancellationToken);

        public void RemovePermanently(SquadMembership membership) => inner.RemovePermanently(membership);
    }

    /// <summary>Serves one match by identity.</summary>
    private sealed class SingleMatchRepository(Match match) : IMatchRepository
    {
        public Task<Match?> GetByIdAsync(Guid matchId, CancellationToken cancellationToken) =>
            Task.FromResult(match.Id == matchId ? match : null);

        public Task AddAsync(Match added, CancellationToken cancellationToken) => throw new NotSupportedException();

        public Task<IReadOnlyList<Match>> GetForSquadAsync(Guid squadId, CancellationToken cancellationToken) =>
            throw new NotSupportedException();

        public Task<IReadOnlyList<Match>> ListChronologicalCompletedForSquadAsync(Guid squadId, CancellationToken cancellationToken) =>
            throw new NotSupportedException();
    }

    /// <summary>
    /// Stored responses keyed by membership. Upserts and removals are staged and applied only when the
    /// unit of work saves, so a write that never commits changes nothing.
    /// </summary>
    private sealed class CommitBoundaryAvailability : IAvailabilityRepository
    {
        private readonly Dictionary<Guid, AvailabilityResponse> _committed = new();
        private readonly List<Action> _staged = [];

        public void Seed(AvailabilityResponse response) => _committed[response.SquadMembershipId] = response;

        public Dictionary<Guid, DateTimeOffset[]> Snapshot() =>
            _committed.ToDictionary(e => e.Key, e => e.Value.MarkedDays.Select(d => d.Instant).ToArray());

        public void Commit()
        {
            _staged.ForEach(apply => apply());
            _staged.Clear();
        }

        public Task UpsertAsync(AvailabilityResponse response, CancellationToken cancellationToken)
        {
            _staged.Add(() => _committed[response.SquadMembershipId] = response);
            return Task.CompletedTask;
        }

        public Task RemoveAsync(AvailabilityResponse response, CancellationToken cancellationToken)
        {
            _staged.Add(() => _committed.Remove(response.SquadMembershipId));
            return Task.CompletedTask;
        }

        public Task<AvailabilityResponse?> GetResponseAsync(Guid matchId, Guid squadMembershipId, CancellationToken cancellationToken) =>
            Task.FromResult(_committed.GetValueOrDefault(squadMembershipId));

        public Task<IReadOnlyList<AvailabilityResponse>> ListResponsesAsync(Guid matchId, CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<AvailabilityResponse>>([.. _committed.Values]);
    }

    /// <summary>Applies the staged availability writes on save.</summary>
    private sealed class CommittingUnitOfWork(CommitBoundaryAvailability availability) : IUnitOfWork
    {
        public Task<int> SaveChangesAsync(CancellationToken cancellationToken)
        {
            availability.Commit();
            return Task.FromResult(1);
        }
    }
}
