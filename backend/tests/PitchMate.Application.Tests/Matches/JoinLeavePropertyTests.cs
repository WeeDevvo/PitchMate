using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
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
/// Property-based tests for <see cref="JoinMatchHandler"/> and <see cref="LeaveMatchHandler"/>, the
/// writes a member uses to put themselves in or take themselves out of a confirmed match, and example
/// tests for <see cref="AddParticipantHandler"/> now that an admin can add anyone.
/// <para>
/// The property: joining succeeds iff the path squad is the match's own, the caller is an active
/// registered member, the match is confirmed, and the caller isn't already playing; leaving is the
/// mirror image. The first unmet condition decides the failure: the uniform
/// <see cref="MatchErrorCode.Unauthorized"/> for the squad or caller,
/// <see cref="MatchErrorCode.InvalidState"/> for the match's state, then
/// <see cref="MatchErrorCode.AlreadyParticipant"/> or <see cref="MatchErrorCode.NotAParticipant"/>.
/// A failure changes nothing and commits nothing.
/// </para>
/// </summary>
[Trait("Feature", "match-lifecycle")]
public class JoinLeavePropertyTests
{
    /// <summary>Who is asking.</summary>
    public enum CallerKind
    {
        Member,
        Admin,
        InactiveMember,
        Guest,
        NonMember,
    }

    private static readonly DateTimeOffset Now = new(2025, 1, 1, 12, 0, 0, TimeSpan.Zero);

    private static readonly DateTimeOffset Day = Now.AddDays(4);

    private static readonly Gen<(CallerKind, bool, bool, bool, bool)> ScenarioGen =
        from caller in Gen.Elements(Enum.GetValues<CallerKind>())
        from joining in Gen.Elements(true, false)
        from confirmed in Gen.Elements(true, false)
        from alreadyPlaying in Gen.Elements(true, false)
        from pathSquadMatches in Gen.Elements(true, false)
        select (caller, joining, confirmed, alreadyPlaying, pathSquadMatches);

    [Property(MaxTest = 300)]
    public Property AMemberJoinsOrLeavesOnlyThemselvesWhileTheMatchIsConfirmed() =>
        Prop.ForAll(Arb.From(ScenarioGen), scenario =>
        {
            var (caller, joining, confirmed, alreadyPlaying, pathSquadMatches) = scenario;
            var world = World.Create(caller, confirmed, alreadyPlaying);
            Guid pathSquad = pathSquadMatches ? world.SquadId : Guid.NewGuid();
            int before = world.Match.Participants.Count;

            Result result = joining ? world.Join(pathSquad) : world.Leave(pathSquad);

            bool canAct = caller is CallerKind.Member or CallerKind.Admin;
            MatchErrorCode? expected =
                !pathSquadMatches || !canAct ? MatchErrorCode.Unauthorized
                : !confirmed ? MatchErrorCode.InvalidState
                : joining && alreadyPlaying ? MatchErrorCode.AlreadyParticipant
                : !joining && !alreadyPlaying ? MatchErrorCode.NotAParticipant
                : null;

            bool playingAfter = world.CallerIsPlaying();
            bool stateAsExpected = expected is null
                ? playingAfter == joining && world.UnitOfWork.SaveCount == 1
                : world.Match.Participants.Count == before && world.UnitOfWork.SaveCount == 0;

            return (result.Error?.Code == expected && stateAsExpected)
                .Label($"expected {expected?.ToString() ?? "success"}, got {result.Error?.Code.ToString() ?? "success"}");
        });

    // An admin can add a registered member who didn't mark the day, not only a guest.
    [Fact]
    public async Task AnAdmin_AddsARegisteredMember()
    {
        var world = World.Create(CallerKind.Admin, confirmed: true, alreadyPlaying: false);
        SquadMembership member = world.AddMember("Late Larry");

        Result<AddParticipantResult> result = await world.AddHandler.HandleAsync(
            new AddParticipantCommand(world.ActingUserId, world.SquadId, world.Match.Id, member.Id),
            CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error?.Message);
        MatchParticipant added = Assert.Single(world.Match.Participants, p => p.SquadMembershipId == member.Id);
        Assert.False(added.IsGuest);
    }

    // A membership of another squad can't be added, whatever kind it is.
    [Fact]
    public async Task AnAdmin_CannotAddAnotherSquadsMember()
    {
        var world = World.Create(CallerKind.Admin, confirmed: true, alreadyPlaying: false);
        SquadMembership stranger = world.AddMemberOfAnotherSquad();

        Result<AddParticipantResult> result = await world.AddHandler.HandleAsync(
            new AddParticipantCommand(world.ActingUserId, world.SquadId, world.Match.Id, stranger.Id),
            CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Equal(MatchErrorCode.ValidationFailed, result.Error!.Code);
        Assert.DoesNotContain(world.Match.Participants, p => p.SquadMembershipId == stranger.Id);
    }

    /// <summary>A squad, a match drafted on one day, and a caller of the requested kind.</summary>
    private sealed class World
    {
        private readonly SquadStore _store;
        private readonly Guid _otherSquadId;
        private readonly Guid? _callerMembershipId;
        private readonly JoinMatchHandler _join;
        private readonly LeaveMatchHandler _leave;

        private World(
            SquadStore store, Guid squadId, Guid otherSquadId, Match match, Guid actingUserId,
            Guid? callerMembershipId, CountingUnitOfWork unitOfWork, ISquadMembershipRepository memberships)
        {
            _store = store;
            _otherSquadId = otherSquadId;
            SquadId = squadId;
            Match = match;
            ActingUserId = actingUserId;
            _callerMembershipId = callerMembershipId;
            UnitOfWork = unitOfWork;
            var matches = new SingleMatchRepository(match);
            _join = new JoinMatchHandler(matches, memberships, unitOfWork);
            _leave = new LeaveMatchHandler(matches, memberships, unitOfWork);
            AddHandler = new AddParticipantHandler(matches, memberships, unitOfWork);
        }

        public Guid SquadId { get; }

        public Match Match { get; }

        public Guid ActingUserId { get; }

        public CountingUnitOfWork UnitOfWork { get; }

        public AddParticipantHandler AddHandler { get; }

        public static World Create(CallerKind kind, bool confirmed, bool alreadyPlaying)
        {
            var store = new SquadStore();
            Squad squad = Squad.Create("The Squad").Value!;
            Squad other = Squad.Create("Another Squad").Value!;
            store.AddCommittedSquad(squad);
            store.AddCommittedSquad(other);

            Guid userId = Guid.NewGuid();
            SquadMembership? caller = kind switch
            {
                CallerKind.Member => SquadMembership.CreateRegistered(squad.Id, userId, "Member").Value!,
                CallerKind.Admin => Promoted(SquadMembership.CreateRegistered(squad.Id, userId, "Admin").Value!),
                CallerKind.InactiveMember => Inactive(SquadMembership.CreateRegistered(squad.Id, userId, "Gone").Value!),
                // A guest has no account; resolving one for the user models a forged lookup.
                CallerKind.Guest => SquadMembership.CreateGuest(squad.Id, "Guest", skillTier: null, Now).Value!,
                _ => null,
            };

            ISquadMembershipRepository memberships = new FakeSquadMembershipRepository(store);
            if (caller is not null)
            {
                store.AddCommittedMembership(caller);
                if (kind == CallerKind.Guest)
                {
                    memberships = new ResolvesAsCaller(memberships, userId, caller);
                }
            }

            Match match = Match.CreateDraft(Guid.NewGuid(), squad.Id, "Recreation Ground", [Day], Now).Value!;
            if (confirmed)
            {
                Assert.True(match.Confirm(Day, []).IsSuccess);
                if (alreadyPlaying && caller is not null)
                {
                    // Inactive members can't be added through the aggregate; reactivation isn't modelled,
                    // so an inactive caller is simply never playing.
                    match.AddParticipant(caller);
                }
            }

            return new World(store, squad.Id, other.Id, match, userId, caller?.Id, new CountingUnitOfWork(), memberships);
        }

        public Result Join(Guid pathSquad) =>
            _join.HandleAsync(new JoinMatchCommand(ActingUserId, pathSquad, Match.Id), CancellationToken.None)
                .GetAwaiter().GetResult();

        public Result Leave(Guid pathSquad) =>
            _leave.HandleAsync(new LeaveMatchCommand(ActingUserId, pathSquad, Match.Id), CancellationToken.None)
                .GetAwaiter().GetResult();

        public bool CallerIsPlaying() =>
            _callerMembershipId is { } id && Match.Participants.Any(p => p.SquadMembershipId == id);

        public SquadMembership AddMember(string name)
        {
            SquadMembership member = SquadMembership.CreateRegistered(SquadId, Guid.NewGuid(), name).Value!;
            _store.AddCommittedMembership(member);
            return member;
        }

        public SquadMembership AddMemberOfAnotherSquad()
        {
            SquadMembership member = SquadMembership.CreateRegistered(_otherSquadId, Guid.NewGuid(), "Elsewhere").Value!;
            _store.AddCommittedMembership(member);
            return member;
        }

        private static SquadMembership Promoted(SquadMembership membership)
        {
            membership.PromoteToAdmin();
            return membership;
        }

        private static SquadMembership Inactive(SquadMembership membership)
        {
            membership.Deactivate();
            return membership;
        }
    }

    /// <summary>Resolves a guest membership for the acting user, which no real lookup can do; otherwise delegates.</summary>
    private sealed class ResolvesAsCaller(ISquadMembershipRepository inner, Guid userId, SquadMembership caller)
        : ISquadMembershipRepository
    {
        public Task<SquadMembership?> GetByUserAndSquadAsync(Guid actingUserId, Guid squadId, CancellationToken cancellationToken) =>
            actingUserId == userId && squadId == caller.SquadId
                ? Task.FromResult<SquadMembership?>(caller)
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

    /// <summary>Counts commits, so a refused write can be shown to have committed nothing.</summary>
    private sealed class CountingUnitOfWork : IUnitOfWork
    {
        public int SaveCount { get; private set; }

        public Task<int> SaveChangesAsync(CancellationToken cancellationToken)
        {
            SaveCount++;
            return Task.FromResult(1);
        }
    }
}
