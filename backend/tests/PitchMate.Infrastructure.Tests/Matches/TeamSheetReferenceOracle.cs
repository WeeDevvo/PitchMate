using PitchMate.Domain.Matches;

namespace PitchMate.Infrastructure.Tests.Matches;

/// <summary>
/// The <c>Reference_Oracle</c> for the team sheet (match-read-models task 13.8): the projection of a
/// seeded match's captured lineup, read off the aggregate with names from the one display-name rule
/// (<see cref="WorkingTeamsReferenceOracle.DisplayNameOf"/>), and compared structurally.
/// </summary>
internal static class TeamSheetReferenceOracle
{
    /// <summary>Asserts a sheet projects <paramref name="match"/>'s captured lineup.</summary>
    /// <param name="squad">The seeded squad owning the match, for the memberships' final state.</param>
    /// <param name="match">The aggregate that captured the lineup.</param>
    /// <param name="actual">The sheet the read returned.</param>
    /// <param name="deletedParticipants">Participants planted as deleted, which must resolve to the placeholder.</param>
    public static void AssertProjects(
        SeededMatchListDataset.SquadData squad,
        Match match,
        TeamSheet actual,
        IReadOnlySet<Guid>? deletedParticipants = null)
    {
        KickoffLineup lineup = match.KickoffLineup!;

        Assert.Equal(match.Location, actual.Location);
        Assert.Equal(match.ConfirmedDay!.Value.Instant, actual.ConfirmedDay);
        Assert.Equal(lineup.Teams.Count, actual.Teams.Count);
        Assert.Equal(1, actual.Teams.Count(static team => team.BibFlag));

        for (int i = 0; i < lineup.Teams.Count; i++)
        {
            KickoffTeam locked = lineup.Teams[i];
            TeamSheetTeam team = actual.Teams[i];

            Assert.Equal(locked.TeamName, team.TeamName);
            Assert.Equal(locked.BibFlag, team.BibFlag);
            Assert.Equal(
                locked.ParticipantMembershipIds.Select(id => new RosterEntry(
                    id,
                    deletedParticipants?.Contains(id) == true
                        ? PitchMate.Domain.Squads.SquadMembership.DisplayNamePlaceholder
                        : WorkingTeamsReferenceOracle.DisplayNameOf(squad, match, id))),
                team.Roster);
        }

        // The identity set equals the lineup's, each identity on exactly one team.
        List<Guid> rostered = [.. actual.Teams.SelectMany(static team => team.Roster).Select(static entry => entry.SquadMembershipId)];
        Assert.Equal(rostered.Count, rostered.Distinct().Count());
        Assert.Equal(
            lineup.Teams.SelectMany(static team => team.ParticipantMembershipIds).Order(),
            rostered.Order());
    }
}
