using PitchMate.Domain.Matches;
using SquadMembership = PitchMate.Domain.Squads.SquadMembership;

namespace PitchMate.Domain.Tests.Matches;

/// <summary>
/// Unit tests for undoing a kickoff made by mistake. A match in play with nothing recorded returns to
/// TeamsRolled with its teams locked, its kickoff lineup kept and no kickoff instant, and can be
/// started again. A match not in play is refused as an invalid state, and one with live events or a
/// recorded result is refused as play recorded; every refusal leaves the match unchanged.
/// </summary>
[Trait("Feature", "match-lifecycle")]
public class MatchUndoStartTests
{
    private static readonly DateTimeOffset Now = new(2025, 1, 1, 0, 0, 0, TimeSpan.Zero);

    private static readonly DateTimeOffset Kickoff = Now.AddDays(3).AddHours(19);

    private static readonly Guid SquadId = Guid.NewGuid();

    [Fact]
    public void UndoingAStartWithNothingRecorded_ReturnsToLockedTeams_KeepingTheLineup()
    {
        Match match = LockedMatch();
        KickoffLineup lineup = match.KickoffLineup!;
        Assert.True(match.Start(Kickoff).IsSuccess);

        Result undone = match.UndoStart(hasLiveEvents: false);

        Assert.True(undone.IsSuccess, undone.Error?.Message);
        Assert.Equal(MatchState.TeamsRolled, match.State);
        Assert.Null(match.StartedAt);
        Assert.Same(lineup, match.KickoffLineup);
    }

    [Fact]
    public void AnUndoneMatch_CanBeStartedAgain_WithAFreshKickoffInstant()
    {
        Match match = LockedMatch();
        Assert.True(match.Start(Kickoff).IsSuccess);
        Assert.True(match.UndoStart(hasLiveEvents: false).IsSuccess);

        DateTimeOffset restart = Kickoff.AddMinutes(10);
        Assert.True(match.Start(restart).IsSuccess);

        Assert.Equal(MatchState.InProgress, match.State);
        Assert.Equal(restart, match.StartedAt);
    }

    [Fact]
    public void AMatchNotInPlay_IsRefusedAsAnInvalidState()
    {
        Match match = LockedMatch();

        Result refused = match.UndoStart(hasLiveEvents: false);

        Assert.False(refused.IsSuccess);
        Assert.Equal(MatchErrorCode.InvalidState, refused.Error!.Code);
        Assert.Equal(MatchState.TeamsRolled, match.State);
    }

    [Fact]
    public void AMatchWithLiveEvents_IsRefusedAsPlayRecorded_AndStaysInPlay()
    {
        Match match = LockedMatch();
        Assert.True(match.Start(Kickoff).IsSuccess);

        Result refused = match.UndoStart(hasLiveEvents: true);

        Assert.False(refused.IsSuccess);
        Assert.Equal(MatchErrorCode.PlayRecorded, refused.Error!.Code);
        Assert.Equal(MatchState.InProgress, match.State);
        Assert.Equal(Kickoff, match.StartedAt);
    }

    [Fact]
    public void AMatchWithARecordedResult_IsRefusedAsPlayRecorded_AndStaysInPlay()
    {
        Match match = LockedMatch();
        Assert.True(match.Start(Kickoff).IsSuccess);
        var scores = match.KickoffLineup!.Teams.Select(t => new TeamScore(t.TeamId, 1));
        Assert.True(match.RecordResult(new MatchResult(ResultFidelity.Basic, scores), liveTrackingEnabled: false).IsSuccess);

        Result refused = match.UndoStart(hasLiveEvents: false);

        Assert.False(refused.IsSuccess);
        Assert.Equal(MatchErrorCode.PlayRecorded, refused.Error!.Code);
        Assert.Equal(MatchState.InProgress, match.State);
        Assert.Equal(Kickoff, match.StartedAt);
    }

    private static Match LockedMatch()
    {
        DateTimeOffset day = Now.AddDays(3);
        Match match = Match.CreateDraft(Guid.NewGuid(), SquadId, "Riverside", [day], Now).Value!;
        Assert.True(match.Confirm(day, []).IsSuccess);

        var players = Enumerable.Range(1, 10)
            .Select(i => SquadMembership.CreateRegistered(SquadId, Guid.NewGuid(), $"Player {i}").Value!)
            .ToList();
        foreach (SquadMembership player in players)
        {
            Assert.True(match.AddParticipant(player).IsSuccess);
        }

        Assert.True(match.ApplyTeamProposal(
        [
            new ProposedTeam("Reds", BibFlag: true, [.. players.Take(5).Select(p => p.Id)]),
            new ProposedTeam("Blues", BibFlag: false, [.. players.Skip(5).Select(p => p.Id)]),
        ]).IsSuccess);
        Assert.True(match.Lock().IsSuccess);
        return match;
    }
}
