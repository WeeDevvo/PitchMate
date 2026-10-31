using PitchMate.Application.Matches.UseCases;
using PitchMate.Domain.Common;
using PitchMate.Domain.Matches;
using PitchMate.Domain.Rating;
using SquadMembership = PitchMate.Domain.Squads.SquadMembership;

namespace PitchMate.Infrastructure.Tests.Matches;

/// <summary>
/// The <c>Reference_Oracle</c> extended with the working-teams projection (match-read-models task 11.9):
/// what <see cref="GetWorkingTeamsHandler"/> must answer for a seeded match, read off the aggregate.
/// <para>
/// Teams are in creation order — the order of their v7 identities under <see cref="UuidV7Comparer"/>,
/// the same total order the database applies — each roster in stored order, names and bib flags exactly
/// as the aggregate holds them. Display names are <see cref="ParticipantDisplayName.Resolve"/> over the
/// participant's captured name and the membership's final state; an identity with no participant is the
/// placeholder. The prediction is obtained from the <b>same</b> <see cref="IRatingEngine"/> instance the
/// implementation is given, over the same rosters, seeding unrated members the same way.
/// </para>
/// </summary>
internal static class WorkingTeamsReferenceOracle
{
    /// <summary>The prediction tolerance: the oracle and the implementation call the same engine.</summary>
    public const double Tolerance = 1e-9;

    /// <summary>The view the handler must return for <paramref name="match"/>, prediction included.</summary>
    public static WorkingTeamsView Expected(SeededMatchListDataset.SquadData squad, Match match, IRatingEngine engine)
    {
        ArgumentNullException.ThrowIfNull(squad);
        ArgumentNullException.ThrowIfNull(match);
        ArgumentNullException.ThrowIfNull(engine);

        List<WorkingTeamView> teams =
        [
            .. match.Teams
                .OrderBy(static team => team.Id, UuidV7Comparer.Instance)
                .Select(team => new WorkingTeamView(
                    team.Id,
                    team.TeamName,
                    team.BibFlag,
                    [.. team.Roster.Select(id => new RosterEntry(id, DisplayNameOf(squad, match, id)))])),
        ];

        HashSet<Guid> rostered = [.. teams.SelectMany(static team => team.Roster).Select(static entry => entry.SquadMembershipId)];
        List<Guid> unassigned =
        [
            .. match.Participants
                .OrderBy(static participant => participant.RosterPosition)
                .Select(static participant => participant.SquadMembershipId)
                .Where(id => !rostered.Contains(id)),
        ];

        SplitPrediction? prediction = teams.Count >= 2 && teams.All(static team => team.Roster.Count > 0)
            ? Predict(squad, teams, engine)
            : null;

        return new WorkingTeamsView(teams, prediction, unassigned);
    }

    /// <summary>Asserts a handler view agrees with the oracle's, probabilities within <see cref="Tolerance"/>.</summary>
    public static void AssertAgrees(WorkingTeamsView expected, WorkingTeamsView? actual)
    {
        Assert.NotNull(actual);

        Assert.Equal(expected.Teams.Count, actual!.Teams.Count);
        for (int i = 0; i < expected.Teams.Count; i++)
        {
            Assert.Equal(expected.Teams[i].TeamId, actual.Teams[i].TeamId);
            Assert.Equal(expected.Teams[i].TeamName, actual.Teams[i].TeamName);
            Assert.Equal(expected.Teams[i].BibFlag, actual.Teams[i].BibFlag);
            Assert.Equal(expected.Teams[i].Roster, actual.Teams[i].Roster);
        }

        Assert.Equal(expected.UnassignedParticipants, actual.UnassignedParticipants);

        if (expected.Prediction is null)
        {
            Assert.Null(actual.Prediction);
            return;
        }

        Assert.NotNull(actual.Prediction);
        Assert.Equal(expected.Prediction.WinProbabilities.Count, actual.Prediction!.WinProbabilities.Count);
        for (int i = 0; i < expected.Prediction.WinProbabilities.Count; i++)
        {
            Assert.Equal(expected.Prediction.WinProbabilities[i], actual.Prediction.WinProbabilities[i], Tolerance);
        }

        Assert.Equal(expected.Prediction.DrawProbability, actual.Prediction.DrawProbability, Tolerance);
    }

    private static SplitPrediction Predict(SeededMatchListDataset.SquadData squad, IReadOnlyList<WorkingTeamView> teams, IRatingEngine engine)
    {
        List<TeamRoster> rosters =
        [
            .. teams.Select(team => new TeamRoster(
            [
                .. team.Roster.Select(entry => squad.Ratings.TryGetValue(entry.SquadMembershipId, out Rating persisted)
                    ? persisted
                    : engine.CreateRating(squad.Memberships.SingleOrDefault(m => m.Id == entry.SquadMembershipId)?.SkillTier).Value),
            ])),
        ];

        // Shown as shares of the whole outcome: each engine win scaled by 1 − draw, so wins and draw sum to 1.
        MatchPrediction prediction = engine.Predict(rosters).Value!;
        double draw = prediction.DrawProbability;
        return new SplitPrediction([.. prediction.WinProbabilities.Select(win => win * (1.0 - draw))], draw);
    }

    /// <summary>
    /// The display-name-at-time of an identity in a match: the Domain rule over the participant's captured
    /// name and the membership's final state, or the placeholder when the match holds no participant.
    /// </summary>
    internal static string DisplayNameOf(SeededMatchListDataset.SquadData squad, Match match, Guid membershipId)
    {
        MatchParticipant? participant = match.Participants.SingleOrDefault(p => p.SquadMembershipId == membershipId);
        if (participant is null)
        {
            return SquadMembership.DisplayNamePlaceholder;
        }

        SquadMembership? membership = squad.Memberships.SingleOrDefault(m => m.Id == membershipId);
        return ParticipantDisplayName.Resolve(
            participant.DisplayName,
            membershipResolved: membership is not null,
            isAnonymised: membership?.DisplayNameNormalized is null);
    }
}
