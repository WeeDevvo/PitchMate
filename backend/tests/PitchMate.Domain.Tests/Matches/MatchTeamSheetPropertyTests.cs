using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Domain.Matches;
using PitchMate.Domain.Squads;

namespace PitchMate.Domain.Tests.Matches;

/// <summary>
/// Property-based tests for the team sheet read model (match-lifecycle design Property 12).
/// <para>
/// For any match in <see cref="MatchState.TeamsRolled"/>, the produced <see cref="TeamSheet"/>
/// presents the match's <see cref="Match.Location"/>, its <see cref="Match.ConfirmedDay"/>, and each
/// team with its name, bib flag, and roster of participant display names in roster order, and
/// indicates exactly one bib-wearing team corresponding to the team whose bib flag is set
/// (Requirement 9.1, 9.2).
/// </para>
/// <para>
/// The test builds a confirmed match at a generated location and confirmed day, populates exactly the
/// participants required by the two generated team sizes (each 5..8, so uneven splits such as 7v6
/// occur and every lock succeeds), gives each participant a distinct display name so roster order is
/// observable, applies a proposal partitioning them into the two named teams with a single generated
/// bib team, locks, and projects the sheet. An independent oracle rebuilds the expected per-team
/// (name, bib, ordered display-name roster) tuples directly from the locked teams and asserts the
/// sheet mirrors them, the location and confirmed day match the match, and exactly one team is
/// flagged for bibs. The property runs at least 100 iterations.
/// </para>
/// </summary>
[Trait("Feature", "match-lifecycle")]
public class MatchTeamSheetPropertyTests
{
    /// <summary>The clock instant the generated match is drafted against; the confirmed day is strictly after it.</summary>
    private static readonly DateTimeOffset NowUtc = new(2025, 1, 1, 0, 0, 0, TimeSpan.Zero);

    // Feature: match-lifecycle, Property 12: The team sheet reflects the locked teams with a single
    // bib team - for any match in TeamsRolled, the produced team sheet presents the match location,
    // the confirmed day, and each team with its name, bib flag, and roster of participant display
    // names in roster order, and indicates exactly one bib-wearing team corresponding to the team
    // whose bib flag is set.
    // Validates: Requirements 9.1, 9.2
    [Property(MaxTest = 100)]
    [Trait("Property", "12")]
    public Property TeamSheetReflectsLockedTeamsWithASingleBibTeam() =>
        Prop.ForAll(Arb.From(ScenarioGen()), scenario =>
        {
            var squadId = Guid.NewGuid();
            var day = NowUtc.AddDays(scenario.DayOffsetDays);
            var match = ConfirmedMatch(squadId, scenario.Location, day);

            // Add exactly sizeA + sizeB participants with distinct display names; the first sizeA go to
            // team A (in add order), the rest to team B, so roster order is deterministic and observable.
            var displayNamesById = new Dictionary<Guid, string>();
            var participantIds = new List<Guid>(scenario.SizeA + scenario.SizeB);
            for (var i = 0; i < scenario.SizeA + scenario.SizeB; i++)
            {
                var displayName = $"Player {i}";
                var membership = SquadMembership.CreateRegistered(squadId, Guid.NewGuid(), displayName).Value!;
                if (!match.AddParticipant(membership).IsSuccess)
                {
                    return false;
                }

                participantIds.Add(membership.Id);
                displayNamesById[membership.Id] = displayName;
            }

            var teamARoster = participantIds.Take(scenario.SizeA).ToList();
            var teamBRoster = participantIds.Skip(scenario.SizeA).ToList();

            var proposal = new List<ProposedTeam>
            {
                new(scenario.NameA, scenario.BibOnA, teamARoster),
                new(scenario.NameB, !scenario.BibOnA, teamBRoster)
            };

            if (!match.ApplyTeamProposal(proposal).IsSuccess || !match.Lock().IsSuccess)
            {
                return false;
            }

            var result = match.ProduceTeamSheet();
            if (!result.IsSuccess)
            {
                return false;
            }

            var sheet = result.Value!;

            // Location and confirmed day reflect the match (Requirement 9.1).
            if (sheet.Location != match.Location || !sheet.ConfirmedDay.Equals(match.ConfirmedDay!.Value))
            {
                return false;
            }

            // The sheet's teams mirror the locked teams: order, name, bib flag, and roster display
            // names in roster order (Requirement 9.1).
            var expected = new List<(string Name, bool Bib, List<string> Roster)>
            {
                (scenario.NameA, scenario.BibOnA, teamARoster.Select(id => displayNamesById[id]).ToList()),
                (scenario.NameB, !scenario.BibOnA, teamBRoster.Select(id => displayNamesById[id]).ToList())
            };

            if (sheet.Teams.Count != expected.Count)
            {
                return false;
            }

            for (var i = 0; i < expected.Count; i++)
            {
                var team = sheet.Teams[i];
                if (team.TeamName != expected[i].Name
                    || team.BibFlag != expected[i].Bib
                    || !team.Roster.SequenceEqual(expected[i].Roster))
                {
                    return false;
                }
            }

            // Exactly one team on the sheet is the bib-wearing team (Requirement 9.2).
            return sheet.Teams.Count(t => t.BibFlag) == 1;
        });

    /// <summary>
    /// Creates a match drafted for <paramref name="squadId"/> at <paramref name="location"/> with the
    /// single candidate day <paramref name="day"/>, confirmed on that day with an empty participant
    /// pool, leaving it in <see cref="MatchState.Confirmed"/> with <paramref name="day"/> as its
    /// confirmed day, ready for participants and team rolling.
    /// </summary>
    private static Match ConfirmedMatch(Guid squadId, string location, DateTimeOffset day)
    {
        var match = Match.CreateDraft(Guid.Empty, squadId, location, [day], NowUtc).Value!;
        match.Confirm(day, availableCount: 0, minimumThreshold: 0, activeRegisteredMembers: []);
        return match;
    }

    // ---- Generators -----------------------------------------------------------------------------

    /// <summary>
    /// A generated team-sheet scenario: the two teams' valid sizes and distinct names, which team wears
    /// bibs, and the match's location and confirmed-day offset.
    /// </summary>
    private sealed record Scenario(
        int SizeA,
        int SizeB,
        string NameA,
        string NameB,
        bool BibOnA,
        string Location,
        int DayOffsetDays);

    /// <summary>
    /// Generates two valid team sizes in 5..8 (so both accept and uneven splits such as 7v6 occur and
    /// every lock succeeds), two distinct valid team names, a bib assignment placing the single bib on
    /// one team, a location from a small pool, and a confirmed-day offset of 1..14 days.
    /// </summary>
    private static Gen<Scenario> ScenarioGen() =>
        from sizeA in Gen.Choose(Match.TeamMinSize, Match.TeamMaxSize)
        from sizeB in Gen.Choose(Match.TeamMinSize, Match.TeamMaxSize)
        from names in Gen.Elements(
            ("Reds", "Blues"),
            ("Team Alpha", "Team Beta"),
            ("Home", "Away"),
            ("Lions", "Tigers"))
        from bibOnA in Gen.Elements(true, false)
        from location in Gen.Elements("Community Astro Pitch", "Riverside 3G", "The Cage")
        from dayOffsetDays in Gen.Choose(1, 14)
        select new Scenario(sizeA, sizeB, names.Item1, names.Item2, bibOnA, location, dayOffsetDays);
}
