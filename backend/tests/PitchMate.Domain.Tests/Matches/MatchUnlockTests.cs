using PitchMate.Domain.Matches;
using SquadMembership = PitchMate.Domain.Squads.SquadMembership;

namespace PitchMate.Domain.Tests.Matches;

/// <summary>
/// Unit tests for unlocking teams before kickoff. Unlocking a locked match returns it to Confirmed,
/// discards the captured kickoff lineup and keeps the working teams, so a player can be added and the
/// teams re-locked with them in the new lineup. A match that is not locked, including one already in
/// play, cannot be unlocked and is left unchanged.
/// </summary>
[Trait("Feature", "match-lifecycle")]
public class MatchUnlockTests
{
    private static readonly DateTimeOffset Now = new(2025, 1, 1, 0, 0, 0, TimeSpan.Zero);

    private static readonly Guid SquadId = Guid.NewGuid();

    [Fact]
    public void Unlocking_ReturnsToConfirmed_DropsTheLineup_AndKeepsTheTeams()
    {
        Match match = LockedMatch(playerCount: 10);
        var teamsBefore = match.Teams.Select(team => (team.TeamName, team.BibFlag, Roster: team.Roster.ToList())).ToList();

        Result unlocked = match.Unlock();

        Assert.True(unlocked.IsSuccess, unlocked.Error?.Message);
        Assert.Equal(MatchState.Confirmed, match.State);
        Assert.Null(match.KickoffLineup);
        Assert.Equal(
            teamsBefore,
            match.Teams.Select(team => (team.TeamName, team.BibFlag, Roster: team.Roster.ToList())).ToList(),
            new TeamComparer());
    }

    [Fact]
    public void AfterUnlocking_APlayerCanBeAdded_AndTheRelockIncludesThem()
    {
        Match match = LockedMatch(playerCount: 10);
        SquadMembership late = Member("Late");

        Assert.False(match.AddParticipant(late).IsSuccess);
        Assert.True(match.Unlock().IsSuccess);
        Assert.True(match.AddParticipant(late).IsSuccess);

        MatchTeam smaller = match.Teams.OrderBy(team => team.Roster.Count).First();
        Assert.True(match.MoveParticipant(late.Id, smaller.Id).IsSuccess);
        Result relocked = match.Lock();

        Assert.True(relocked.IsSuccess, relocked.Error?.Message);
        Assert.Equal(MatchState.TeamsRolled, match.State);
        Assert.Contains(match.KickoffLineup!.Teams, team => team.ParticipantMembershipIds.Contains(late.Id));
    }

    [Fact]
    public void AConfirmedMatch_CannotBeUnlocked()
    {
        DateTimeOffset day = Now.AddDays(3);
        Match match = Match.CreateDraft(Guid.NewGuid(), SquadId, "Riverside", [day], Now).Value!;
        Assert.True(match.Confirm(day, []).IsSuccess);

        Result refused = match.Unlock();

        Assert.False(refused.IsSuccess);
        Assert.Equal(MatchErrorCode.InvalidState, refused.Error!.Code);
        Assert.Equal(MatchState.Confirmed, match.State);
    }

    [Fact]
    public void AMatchInPlay_CannotBeUnlocked_AndKeepsItsLineup()
    {
        Match match = LockedMatch(playerCount: 10);
        Assert.True(match.Start().IsSuccess);
        KickoffLineup lineup = match.KickoffLineup!;

        Result refused = match.Unlock();

        Assert.False(refused.IsSuccess);
        Assert.Equal(MatchErrorCode.InvalidState, refused.Error!.Code);
        Assert.Equal(MatchState.InProgress, match.State);
        Assert.Same(lineup, match.KickoffLineup);
    }

    private static Match LockedMatch(int playerCount)
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
        Result locked = match.Lock();
        Assert.True(locked.IsSuccess, locked.Error?.Message);
        return match;
    }

    private static SquadMembership Member(string name) =>
        SquadMembership.CreateRegistered(SquadId, Guid.NewGuid(), name).Value!;

    private sealed class TeamComparer : IEqualityComparer<(string TeamName, bool BibFlag, List<Guid> Roster)>
    {
        public bool Equals((string TeamName, bool BibFlag, List<Guid> Roster) x, (string TeamName, bool BibFlag, List<Guid> Roster) y) =>
            x.TeamName == y.TeamName && x.BibFlag == y.BibFlag && x.Roster.SequenceEqual(y.Roster);

        public int GetHashCode((string TeamName, bool BibFlag, List<Guid> Roster) obj) =>
            HashCode.Combine(obj.TeamName, obj.BibFlag);
    }
}
