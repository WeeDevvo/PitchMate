using PitchMate.Application.Matches.UseCases;
using PitchMate.Domain.Matches;
using PitchMate.Domain.Squads;

namespace PitchMate.Application.Tests.Matches;

/// <summary>
/// Unit tests for <see cref="UnlockTeamsHandler"/>: an organiser unlocks a locked match, which
/// returns to Confirmed with no kickoff lineup and is saved once; a match that is not locked is
/// refused with an invalid-state failure and nothing is saved; a plain member, and an unknown match,
/// get the single uniform authorisation failure.
/// </summary>
[Trait("Feature", "match-lifecycle")]
public class UnlockTeamsHandlerTests
{
    private static readonly DateTimeOffset Anchor = new(2025, 1, 1, 12, 0, 0, TimeSpan.Zero);

    private static readonly DateTimeOffset ConfirmedDay = Anchor.AddDays(7);

    [Fact]
    public async Task AnOrganiser_UnlocksALockedMatch_AndItIsSavedOnce()
    {
        World world = World.Build(locked: true);

        var result = await world.Handler.HandleAsync(
            new UnlockTeamsCommand(world.OwnerUserId, world.Match.Id), CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error?.Message);
        Assert.Equal(world.Match.Id, result.Value!.MatchId);
        Assert.Equal(MatchState.Confirmed, world.Match.State);
        Assert.Null(world.Match.KickoffLineup);
        Assert.Equal(1, world.UnitOfWork.SaveCallCount);
    }

    [Fact]
    public async Task AMatchThatIsNotLocked_IsRefused_AndNothingIsSaved()
    {
        World world = World.Build(locked: false);

        var result = await world.Handler.HandleAsync(
            new UnlockTeamsCommand(world.OwnerUserId, world.Match.Id), CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Equal(MatchErrorCode.InvalidState, result.Error!.Code);
        Assert.Equal(0, world.UnitOfWork.SaveCallCount);
    }

    [Fact]
    public async Task APlainMember_GetsTheUniformFailure_AndTheMatchStaysLocked()
    {
        World world = World.Build(locked: true);

        var result = await world.Handler.HandleAsync(
            new UnlockTeamsCommand(world.MemberUserId, world.Match.Id), CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Equal(MatchErrorCode.Unauthorized, result.Error!.Code);
        Assert.Equal(MatchState.TeamsRolled, world.Match.State);
        Assert.NotNull(world.Match.KickoffLineup);
        Assert.Equal(0, world.UnitOfWork.SaveCallCount);
    }

    [Fact]
    public async Task AnUnknownMatch_GetsTheUniformFailure()
    {
        World world = World.Build(locked: true);

        var result = await world.Handler.HandleAsync(
            new UnlockTeamsCommand(world.OwnerUserId, Guid.NewGuid()), CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Equal(MatchErrorCode.Unauthorized, result.Error!.Code);
        Assert.Equal(0, world.UnitOfWork.SaveCallCount);
    }

    private sealed class World
    {
        public required UnlockTeamsHandler Handler { get; init; }
        public required Match Match { get; init; }
        public required TeamRollingUnitOfWork UnitOfWork { get; init; }
        public required Guid OwnerUserId { get; init; }
        public required Guid MemberUserId { get; init; }

        public static World Build(bool locked)
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

            if (locked)
            {
                Assert.True(match.Lock().IsSuccess);
            }

            var unitOfWork = new TeamRollingUnitOfWork();
            var handler = new UnlockTeamsHandler(
                new TeamRollingMatchRepository(match),
                new TeamRollingMembershipRepository(members.ToArray()),
                unitOfWork);

            return new World
            {
                Handler = handler,
                Match = match,
                UnitOfWork = unitOfWork,
                OwnerUserId = ownerUserId,
                MemberUserId = memberUserId,
            };
        }
    }
}
