using PitchMate.Domain.Matches;
using SquadMembership = PitchMate.Domain.Squads.SquadMembership;

namespace PitchMate.Domain.Tests.Matches;

/// <summary>
/// Unit tests for a player list that changes after the teams were rolled. Removing a player takes
/// them off their team as well; a player who joined afterwards is on no team until moved onto one;
/// and the teams can't be locked while any player is on no team, so nobody is silently left out of
/// the kickoff lineup.
/// </summary>
[Trait("Feature", "match-lifecycle")]
public class MatchLateJoinerTests
{
    private static readonly DateTimeOffset Now = new(2025, 1, 1, 0, 0, 0, TimeSpan.Zero);

    private static readonly Guid SquadId = Guid.NewGuid();

    [Fact]
    public void RemovingAPlayer_TakesThemOffTheirTeam()
    {
        (Match match, List<SquadMembership> players) = RolledMatch(playerCount: 11);
        Guid leaver = players[0].Id;

        Assert.True(match.RemoveParticipant(leaver).IsSuccess);

        Assert.DoesNotContain(match.Teams, team => team.Roster.Contains(leaver));
        Assert.Equal(10, match.Teams.Sum(team => team.Roster.Count));
    }

    [Fact]
    public void ALateJoiner_IsOnNoTeam_AndBlocksTheLockUntilPlaced()
    {
        (Match match, _) = RolledMatch(playerCount: 10);
        SquadMembership lateJoiner = Member("Late");
        Assert.True(match.AddParticipant(lateJoiner).IsSuccess);

        Assert.DoesNotContain(match.Teams, team => team.Roster.Contains(lateJoiner.Id));
        Result refused = match.Lock();
        Assert.False(refused.IsSuccess);
        Assert.Equal(MatchErrorCode.ValidationFailed, refused.Error!.Code);
        Assert.Equal(MatchState.Confirmed, match.State);

        MatchTeam smaller = match.Teams.OrderBy(team => team.Roster.Count).First();
        Assert.True(match.MoveParticipant(lateJoiner.Id, smaller.Id).IsSuccess);
        Assert.Contains(lateJoiner.Id, smaller.Roster);

        Result locked = match.Lock();
        Assert.True(locked.IsSuccess, locked.Error?.Message);
        Assert.Contains(match.KickoffLineup!.Teams, team => team.ParticipantMembershipIds.Contains(lateJoiner.Id));
    }

    private static (Match Match, List<SquadMembership> Players) RolledMatch(int playerCount)
    {
        DateTimeOffset day = Now.AddDays(3);
        Match match = Match.CreateDraft(Guid.NewGuid(), SquadId, "Riverside", [day], Now).Value!;
        Assert.True(match.Confirm(day, []).IsSuccess);

        var players = Enumerable.Range(1, playerCount).Select(i => Member($"Player {i}")).ToList();
        foreach (SquadMembership player in players)
        {
            Assert.True(match.AddParticipant(player).IsSuccess);
        }

        int half = playerCount / 2;
        Result applied = match.ApplyTeamProposal(
        [
            new ProposedTeam("Reds", BibFlag: true, [.. players.Take(half).Select(p => p.Id)]),
            new ProposedTeam("Blues", BibFlag: false, [.. players.Skip(half).Select(p => p.Id)]),
        ]);
        Assert.True(applied.IsSuccess, applied.Error?.Message);
        return (match, players);
    }

    private static SquadMembership Member(string name) =>
        SquadMembership.CreateRegistered(SquadId, Guid.NewGuid(), name).Value!;
}
