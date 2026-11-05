using PitchMate.Application.Matches.UseCases;
using PitchMate.Application.Tests.LiveTracking;
using PitchMate.Domain.LiveTracking;
using PitchMate.Domain.Matches;
using PitchMate.Domain.Squads;

namespace PitchMate.Application.Tests.Matches;

/// <summary>
/// Unit tests for <see cref="UndoMatchStartHandler"/>: an organiser undoes the kickoff of a match in
/// play with nothing recorded, which returns to TeamsRolled with its lineup kept and no kickoff
/// instant and is saved once. A match not in play is refused as an invalid state, and one with any
/// live-tracking event as play recorded; a plain member and an unknown match get the single uniform
/// authorisation failure. No refusal saves anything or changes the match.
/// </summary>
[Trait("Feature", "match-lifecycle")]
public class UndoMatchStartHandlerTests
{
    private static readonly DateTimeOffset Anchor = new(2025, 1, 1, 12, 0, 0, TimeSpan.Zero);

    private static readonly DateTimeOffset ConfirmedDay = Anchor.AddDays(7);

    [Fact]
    public async Task AnOrganiser_UndoesAKickoffWithNothingRecorded_AndItIsSavedOnce()
    {
        World world = World.Build(started: true);

        var result = await world.Handler.HandleAsync(
            new UndoMatchStartCommand(world.OwnerUserId, world.Match.Id), CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error?.Message);
        Assert.Equal(world.Match.Id, result.Value!.MatchId);
        Assert.Equal(MatchState.TeamsRolled, world.Match.State);
        Assert.Null(world.Match.StartedAt);
        Assert.NotNull(world.Match.KickoffLineup);
        Assert.Equal(1, world.UnitOfWork.SaveCallCount);
    }

    [Fact]
    public async Task AMatchNotInPlay_IsRefused_AndNothingIsSaved()
    {
        World world = World.Build(started: false);

        var result = await world.Handler.HandleAsync(
            new UndoMatchStartCommand(world.OwnerUserId, world.Match.Id), CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Equal(MatchErrorCode.InvalidState, result.Error!.Code);
        Assert.Equal(0, world.UnitOfWork.SaveCallCount);
    }

    [Fact]
    public async Task AMatchWithALiveEvent_IsRefusedAsPlayRecorded_AndStaysInPlay()
    {
        World world = World.Build(started: true);
        KickoffTeam team = world.Match.KickoffLineup!.Teams[0];
        world.Events.Seed(new KeeperStintStartedEvent(
            Guid.CreateVersion7(),
            world.Match.Id,
            world.Match.SquadId,
            MatchMinute.Create(0).Value!,
            team.ParticipantMembershipIds[0],
            team.TeamId));

        var result = await world.Handler.HandleAsync(
            new UndoMatchStartCommand(world.OwnerUserId, world.Match.Id), CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Equal(MatchErrorCode.PlayRecorded, result.Error!.Code);
        Assert.Equal(MatchState.InProgress, world.Match.State);
        Assert.NotNull(world.Match.StartedAt);
        Assert.Equal(0, world.UnitOfWork.SaveCallCount);
    }

    [Fact]
    public async Task APlainMember_GetsTheUniformFailure_AndTheMatchStaysInPlay()
    {
        World world = World.Build(started: true);

        var result = await world.Handler.HandleAsync(
            new UndoMatchStartCommand(world.MemberUserId, world.Match.Id), CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Equal(MatchErrorCode.Unauthorized, result.Error!.Code);
        Assert.Equal(MatchState.InProgress, world.Match.State);
        Assert.Equal(0, world.UnitOfWork.SaveCallCount);
    }

    [Fact]
    public async Task ANonMember_GetsTheUniformFailure()
    {
        World world = World.Build(started: true);

        var result = await world.Handler.HandleAsync(
            new UndoMatchStartCommand(Guid.NewGuid(), world.Match.Id), CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Equal(MatchErrorCode.Unauthorized, result.Error!.Code);
        Assert.Equal(MatchState.InProgress, world.Match.State);
        Assert.Equal(0, world.UnitOfWork.SaveCallCount);
    }

    [Fact]
    public async Task AnUnknownMatch_GetsTheUniformFailure()
    {
        World world = World.Build(started: true);

        var result = await world.Handler.HandleAsync(
            new UndoMatchStartCommand(world.OwnerUserId, Guid.NewGuid()), CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Equal(MatchErrorCode.Unauthorized, result.Error!.Code);
        Assert.Equal(0, world.UnitOfWork.SaveCallCount);
    }

    private sealed class World
    {
        public required UndoMatchStartHandler Handler { get; init; }
        public required Match Match { get; init; }
        public required InMemoryMatchEventRepository Events { get; init; }
        public required TeamRollingUnitOfWork UnitOfWork { get; init; }
        public required Guid OwnerUserId { get; init; }
        public required Guid MemberUserId { get; init; }

        public static World Build(bool started)
        {
            Guid squadId = Guid.NewGuid();
            Guid ownerUserId = Guid.NewGuid();
            Guid memberUserId = Guid.NewGuid();
            SquadMembership owner = SquadMembership.CreateOwner(squadId, ownerUserId, "Owner").Value!;

            Match match = Match.CreateDraft(Guid.CreateVersion7(), squadId, "Riverside", [ConfirmedDay], Anchor).Value!;
            match.Confirm(ConfirmedDay, activeMembers: []);

            var members = new List<SquadMembership> { owner };
            for (int i = 0; i < 10; i++)
            {
                Guid userId = i == 0 ? memberUserId : Guid.NewGuid();
                SquadMembership member = SquadMembership.CreateRegistered(squadId, userId, $"Player {i + 1}").Value!;
                match.AddParticipant(member);
                members.Add(member);
            }

            List<Guid> ids = match.Participants.Select(p => p.SquadMembershipId).ToList();
            match.ApplyTeamProposal(
            [
                new ProposedTeam("Reds", BibFlag: true, ids.Take(5).ToList()),
                new ProposedTeam("Blues", BibFlag: false, ids.Skip(5).ToList()),
            ]);
            Assert.True(match.Lock().IsSuccess);

            if (started)
            {
                Assert.True(match.Start(ConfirmedDay.AddHours(19)).IsSuccess);
            }

            var events = new InMemoryMatchEventRepository();
            var unitOfWork = new TeamRollingUnitOfWork();
            var handler = new UndoMatchStartHandler(
                new TeamRollingMatchRepository(match),
                new TeamRollingMembershipRepository(members.ToArray()),
                events,
                unitOfWork);

            return new World
            {
                Handler = handler,
                Match = match,
                Events = events,
                UnitOfWork = unitOfWork,
                OwnerUserId = ownerUserId,
                MemberUserId = memberUserId,
            };
        }
    }
}
