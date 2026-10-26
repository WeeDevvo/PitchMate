using PitchMate.Domain.Matches;
using SquadMembership = PitchMate.Domain.Squads.SquadMembership;

namespace PitchMate.Domain.Tests.Matches;

/// <summary>
/// Unit tests for the team sheet's lineup gate and projection (match-read-models task 13.6).
/// <para>
/// The sheet is readable whenever a lineup has been locked — <see cref="MatchState.TeamsRolled"/>,
/// <see cref="MatchState.InProgress"/>, <see cref="MatchState.Completed"/> and a cancel after lock —
/// and refused with <see cref="MatchErrorCode.InvalidState"/> where none was captured. Producing it is
/// pure; a re-lock re-projects; every rostered identity is carried with a never-empty name, the
/// placeholder where no name was resolved; exactly one team wears bibs; roster order is the lineup's.
/// </para>
/// <para>
/// <b>Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.6, 10.8, 11.8, 11.11.</b>
/// </para>
/// </summary>
[Trait("Feature", "match-read-models")]
public class MatchTeamSheetGateTests
{
    private static readonly DateTimeOffset Now = new(2025, 1, 1, 0, 0, 0, TimeSpan.Zero);

    [Theory]
    [InlineData(MatchState.TeamsRolled)]
    [InlineData(MatchState.InProgress)]
    [InlineData(MatchState.Completed)]
    [InlineData(MatchState.Cancelled)]
    public void SheetIsReadableInEveryStateHoldingALockedLineup(MatchState state)
    {
        World world = World.LockedThen(state);

        Result<TeamSheet> result = world.Match.ProduceTeamSheet(world.Names);

        Assert.True(result.IsSuccess, result.Error?.Message);
        Assert.Equal(state, world.Match.State);
    }

    [Theory]
    [InlineData(MatchState.GatheringAvailability)]
    [InlineData(MatchState.Confirmed)]
    [InlineData(MatchState.Cancelled)]
    public void SheetIsRefusedWhereNoLineupWasCaptured(MatchState state)
    {
        World world = World.UnlockedIn(state);

        Result<TeamSheet> result = world.Match.ProduceTeamSheet(world.Names);

        Assert.False(result.IsSuccess);
        Assert.Null(result.Value);
        Assert.Equal(MatchErrorCode.InvalidState, result.Error!.Code);
    }

    [Fact]
    public void ProducingTheSheetIsPure()
    {
        World world = World.LockedThen(MatchState.TeamsRolled);
        Match match = world.Match;
        (MatchState state, KickoffLineup? lineup, int participants, string teams) before =
            (match.State, match.KickoffLineup, match.Participants.Count, Describe(match.Teams));

        TeamSheet first = match.ProduceTeamSheet(world.Names).Value!;
        TeamSheet second = match.ProduceTeamSheet(world.Names).Value!;

        Assert.Equal(before, (match.State, match.KickoffLineup, match.Participants.Count, Describe(match.Teams)));
        Assert.Equal(Describe(first), Describe(second));
    }

    [Fact]
    public void ARelockReProjectsToTheNewlyLockedTeams()
    {
        World world = World.LockedThen(MatchState.TeamsRolled);
        Match match = world.Match;
        List<MatchTeam> teams = [.. match.Teams];
        Guid moving = teams[0].Roster[0];

        Assert.True(match.MoveParticipant(moving, teams[1].Id).IsSuccess);
        Assert.DoesNotContain(match.ProduceTeamSheet(world.Names).Value!.Teams[1].Roster, entry => entry.SquadMembershipId == moving);

        Assert.True(match.Lock().IsSuccess);
        Assert.Contains(match.ProduceTeamSheet(world.Names).Value!.Teams[1].Roster, entry => entry.SquadMembershipId == moving);
    }

    /// <summary>
    /// A result scores the locked teams the sheet presents. Teams re-rolled after the lock and never
    /// re-locked get fresh working identities, but the lineup is what is played: a result keyed by the
    /// sheet's team ids is accepted, and one keyed by the re-rolled working teams is refused.
    /// </summary>
    [Fact]
    public void AResultScoresTheLockedTeams_EvenAfterAnUnlockedReRoll()
    {
        World world = World.LockedThen(MatchState.TeamsRolled);
        Match match = world.Match;
        List<Guid> sheetIds = [.. match.ProduceTeamSheet(world.Names).Value!.Teams.Select(static team => team.TeamId)];
        List<Guid> ids = [.. world.Names.Keys];

        Assert.True(match.ApplyTeamProposal(
        [
            new ProposedTeam("Greens", BibFlag: true, ids.Skip(5).ToList()),
            new ProposedTeam("Golds", BibFlag: false, ids.Take(5).ToList()),
        ]).IsSuccess);
        List<Guid> rerolledIds = [.. match.Teams.Select(static team => team.Id)];
        Assert.Empty(rerolledIds.Intersect(sheetIds));
        Assert.True(match.Start().IsSuccess);

        Result byWorkingTeams = match.RecordResult(
            new MatchResult(ResultFidelity.Basic, [new TeamScore(rerolledIds[0], 1), new TeamScore(rerolledIds[1], 0)]),
            liveTrackingEnabled: false);
        Assert.Equal(MatchErrorCode.ValidationFailed, byWorkingTeams.Error!.Code);

        Assert.True(match.RecordResult(
            new MatchResult(ResultFidelity.Basic, [new TeamScore(sheetIds[0], 1), new TeamScore(sheetIds[1], 0)]),
            liveTrackingEnabled: false).IsSuccess);
    }

    [Fact]
    public void ProjectionCarriesEveryLockedIdentityInOrder_WithOneBibTeam_AndThePlaceholderForAnUnresolvedName()
    {
        World world = World.LockedThen(MatchState.TeamsRolled);
        Match match = world.Match;
        Guid unresolved = match.KickoffLineup!.Teams[0].ParticipantMembershipIds[1];
        Dictionary<Guid, string> names = new(world.Names);
        names.Remove(unresolved);

        TeamSheet sheet = match.ProduceTeamSheet(names).Value!;

        Assert.Equal(1, sheet.Teams.Count(static team => team.BibFlag));
        for (int i = 0; i < sheet.Teams.Count; i++)
        {
            KickoffTeam locked = match.KickoffLineup.Teams[i];
            Assert.Equal(locked.TeamName, sheet.Teams[i].TeamName);
            Assert.Equal(locked.BibFlag, sheet.Teams[i].BibFlag);
            Assert.Equal(locked.ParticipantMembershipIds, sheet.Teams[i].Roster.Select(static entry => entry.SquadMembershipId));
        }

        Assert.All(sheet.Teams.SelectMany(static team => team.Roster), static entry => Assert.False(string.IsNullOrWhiteSpace(entry.DisplayName)));
        Assert.Equal(
            SquadMembership.DisplayNamePlaceholder,
            sheet.Teams[0].Roster.Single(entry => entry.SquadMembershipId == unresolved).DisplayName);
        Assert.Equal(match.Location, sheet.Location);
        Assert.Equal(match.ConfirmedDay!.Value.Instant, sheet.ConfirmedDay);
    }

    private static string Describe(IEnumerable<MatchTeam> teams) =>
        string.Join("|", teams.Select(static team => $"{team.Id}:{team.TeamName}:{team.BibFlag}:{string.Join(",", team.Roster)}"));

    private static string Describe(TeamSheet sheet) =>
        $"{sheet.Location}@{sheet.ConfirmedDay:O}|" + string.Join("|", sheet.Teams.Select(static team =>
            $"{team.TeamName}:{team.BibFlag}:{string.Join(",", team.Roster.Select(static entry => $"{entry.SquadMembershipId}={entry.DisplayName}"))}"));

    /// <summary>A match driven through the real aggregate, and the resolved names of its participants.</summary>
    private sealed record World(Match Match, IReadOnlyDictionary<Guid, string> Names)
    {
        public static World UnlockedIn(MatchState state)
        {
            Match match = Match.CreateDraft(Guid.Empty, Guid.NewGuid(), "The Cage", [Now.AddDays(3)], Now).Value!;
            if (state == MatchState.GatheringAvailability)
            {
                return new World(match, new Dictionary<Guid, string>());
            }

            Dictionary<Guid, string> names = Confirm(match);
            if (state == MatchState.Cancelled)
            {
                Assert.True(match.Cancel().IsSuccess);
            }

            return new World(match, names);
        }

        public static World LockedThen(MatchState state)
        {
            Match match = Match.CreateDraft(Guid.Empty, Guid.NewGuid(), "The Cage", [Now.AddDays(3)], Now).Value!;
            Dictionary<Guid, string> names = Confirm(match);
            List<Guid> ids = [.. names.Keys];

            Assert.True(match.ApplyTeamProposal(
            [
                new ProposedTeam("Reds", BibFlag: false, ids.Take(6).ToList()),
                new ProposedTeam("Bibs", BibFlag: true, ids.Skip(6).ToList()),
            ]).IsSuccess);
            Assert.True(match.Lock().IsSuccess);

            switch (state)
            {
                case MatchState.Cancelled:
                    Assert.True(match.Cancel().IsSuccess);
                    break;
                case MatchState.InProgress or MatchState.Completed:
                    Assert.True(match.Start().IsSuccess);
                    if (state == MatchState.Completed)
                    {
                        List<MatchTeam> teams = [.. match.Teams];
                        Assert.True(match.RecordResult(
                            new MatchResult(ResultFidelity.Basic, [new TeamScore(teams[0].Id, 2), new TeamScore(teams[1].Id, 1)]),
                            liveTrackingEnabled: false).IsSuccess);
                        Assert.True(match.Complete(Now.AddDays(4)).IsSuccess);
                    }

                    break;
            }

            return new World(match, names);
        }

        private static Dictionary<Guid, string> Confirm(Match match)
        {
            Assert.True(match.Confirm(Now.AddDays(3), activeMembers: []).IsSuccess);

            var names = new Dictionary<Guid, string>();
            for (int i = 0; i < 11; i++)
            {
                SquadMembership member = SquadMembership.CreateRegistered(match.SquadId, Guid.NewGuid(), $"Player {i}").Value!;
                Assert.True(match.AddParticipant(member).IsSuccess);
                names[member.Id] = member.DisplayName;
            }

            return names;
        }
    }
}
