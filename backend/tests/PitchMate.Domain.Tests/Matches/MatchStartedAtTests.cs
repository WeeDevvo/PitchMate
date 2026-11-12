using PitchMate.Domain.Matches;
using SquadMembership = PitchMate.Domain.Squads.SquadMembership;

namespace PitchMate.Domain.Tests.Matches;

/// <summary>
/// Unit tests for the kickoff instant. Starting a locked match records the instant it was started
/// with, which live tracking derives match minutes from; a match that has not started has none, and a
/// refused start records none.
/// </summary>
[Trait("Feature", "match-lifecycle")]
public class MatchStartedAtTests
{
    private static readonly DateTimeOffset Now = new(2025, 1, 1, 0, 0, 0, TimeSpan.Zero);

    private static readonly Guid SquadId = Guid.NewGuid();

    [Fact]
    public void Starting_RecordsTheKickoffInstant()
    {
        Match match = LockedMatch();
        DateTimeOffset kickoff = Now.AddDays(3).AddHours(19);

        Assert.Null(match.StartedAt);
        Assert.True(match.Start(kickoff).IsSuccess);

        Assert.Equal(kickoff, match.StartedAt);
    }

    [Fact]
    public void ARefusedStart_RecordsNoKickoffInstant()
    {
        DateTimeOffset day = Now.AddDays(3);
        Match match = Match.CreateDraft(Guid.NewGuid(), SquadId, "Riverside", [day], Now).Value!;
        Assert.True(match.Confirm(day, []).IsSuccess);

        Result refused = match.Start(day);

        Assert.False(refused.IsSuccess);
        Assert.Null(match.StartedAt);
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
