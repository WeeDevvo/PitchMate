using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Domain.Matches;
using PitchMate.Domain.Squads;

namespace PitchMate.Domain.Tests.Matches;

/// <summary>
/// Property-based tests for locking teams and capturing the kickoff lineup (match-lifecycle design
/// Property 11).
/// <para>
/// For any working two-team set, <see cref="Match.Lock"/> succeeds <em>iff</em> each team's size is
/// 5..8 players (unequal sizes such as 7v6 permitted), exactly one team carries the bib flag, and
/// every team name is 1..50 trimmed characters with no two names equal after trimming and
/// case-insensitive comparison (Requirement 8.5, 8.6, 8.7). On success the match transitions to
/// <see cref="MatchState.TeamsRolled"/> and the captured <see cref="KickoffLineup"/> equals the
/// locked teams and their rosters, and a re-lock while <see cref="MatchState.TeamsRolled"/> replaces
/// the lineup (Requirement 9.3, 10.1). On failure a <see cref="MatchErrorCode.ValidationFailed"/>
/// error is returned and the state and match data — including the absence of a captured lineup — are
/// left unchanged (Requirement 8.7).
/// </para>
/// <para>
/// The test builds a confirmed match, populates exactly the participants required by the two
/// generated team sizes, applies a proposal partitioning them into the two teams with the generated
/// names and bib flags, and locks. Team sizes span 3..10 (straddling the 5..8 bound), names are drawn
/// from a pool exercising valid, empty, whitespace, over-length, and case-insensitively duplicate
/// values, and bib flags exercise zero, one, and two set. An independent oracle decides the expected
/// outcome. The property runs at least 100 iterations.
/// </para>
/// </summary>
[Trait("Feature", "match-lifecycle")]
public class MatchLockPropertyTests
{
    /// <summary>The clock instant the generated match is drafted against; the candidate day is strictly after it.</summary>
    private static readonly DateTimeOffset NowUtc = new(2025, 1, 1, 0, 0, 0, TimeSpan.Zero);

    /// <summary>A team name of 51 characters, one past the maximum trimmed length.</summary>
    private static readonly string OverLongName = new('x', Match.TeamNameMaxLength + 1);

    // Feature: match-lifecycle, Property 11: Locking validates composition and captures the kickoff
    // lineup - for any working team set, Lock succeeds iff each team's size is 5-8 (unequal sizes such
    // as 7v6 permitted), exactly one team carries the bib flag, and every team name is 1-50 trimmed
    // characters with no two names equal case-insensitively; on success the state becomes TeamsRolled
    // and the captured KickoffLineup equals the locked teams and rosters (a re-lock while TeamsRolled
    // replaces it); on failure a validation error names the unmet rule and the state is unchanged.
    // Validates: Requirements 8.5, 8.6, 8.7, 9.3, 10.1
    [Property(MaxTest = 100)]
    [Trait("Property", "11")]
    public Property LockingValidatesCompositionAndCapturesKickoffLineup() =>
        Prop.ForAll(Arb.From(ScenarioGen()), scenario =>
        {
            var squadId = Guid.NewGuid();
            var match = ConfirmedMatch(squadId);

            // Add exactly sizeA + sizeB participants; the first sizeA go to team A, the rest to team B.
            var participantIds = new List<Guid>(scenario.SizeA + scenario.SizeB);
            for (var i = 0; i < scenario.SizeA + scenario.SizeB; i++)
            {
                var membership = SquadMembership.CreateRegistered(squadId, Guid.NewGuid(), $"Player {i}").Value!;
                var added = match.AddParticipant(membership);
                if (!added.IsSuccess)
                {
                    return false;
                }

                participantIds.Add(membership.Id);
            }

            var teamA = participantIds.Take(scenario.SizeA).ToList();
            var teamB = participantIds.Skip(scenario.SizeA).ToList();

            var proposal = new List<ProposedTeam>
            {
                new(scenario.NameA, scenario.BibA, teamA),
                new(scenario.NameB, scenario.BibB, teamB)
            };

            if (!match.ApplyTeamProposal(proposal).IsSuccess)
            {
                return false;
            }

            var result = match.Lock();

            // Oracle: the composition rules, evaluated independently of validation order.
            var trimmedA = scenario.NameA.Trim();
            var trimmedB = scenario.NameB.Trim();
            var sizesOk = InRange(scenario.SizeA) && InRange(scenario.SizeB);
            var bibOk = scenario.BibA ^ scenario.BibB;
            var namesLengthOk = LengthOk(trimmedA) && LengthOk(trimmedB);
            var namesDistinct = !string.Equals(trimmedA, trimmedB, StringComparison.OrdinalIgnoreCase);
            var expectedSuccess = sizesOk && bibOk && namesLengthOk && namesDistinct;

            if (expectedSuccess)
            {
                if (!result.IsSuccess
                    || match.State != MatchState.TeamsRolled
                    || match.KickoffLineup is null)
                {
                    return false;
                }

                // The captured lineup mirrors the locked teams: order, trimmed names, bib flags, rosters.
                if (!LineupMatches(match.KickoffLineup, [(trimmedA, scenario.BibA, teamA), (trimmedB, scenario.BibB, teamB)]))
                {
                    return false;
                }

                // A re-lock while TeamsRolled succeeds and replaces the lineup with an equal capture.
                var relock = match.Lock();
                return relock.IsSuccess
                    && match.State == MatchState.TeamsRolled
                    && match.KickoffLineup is not null
                    && LineupMatches(match.KickoffLineup, [(trimmedA, scenario.BibA, teamA), (trimmedB, scenario.BibB, teamB)]);
            }

            // Failure path: rejected as ValidationFailed, state and lineup unchanged.
            return !result.IsSuccess
                && result.Error!.Code == MatchErrorCode.ValidationFailed
                && match.State == MatchState.Confirmed
                && match.KickoffLineup is null;
        });

    /// <summary>Whether <paramref name="size"/> is a permitted team size (5..8 inclusive).</summary>
    private static bool InRange(int size) => size >= Match.TeamMinSize && size <= Match.TeamMaxSize;

    /// <summary>Whether <paramref name="trimmed"/> is a permitted trimmed team-name length (1..50 inclusive).</summary>
    private static bool LengthOk(string trimmed) =>
        trimmed.Length >= Match.TeamNameMinLength && trimmed.Length <= Match.TeamNameMaxLength;

    /// <summary>Whether <paramref name="lineup"/> mirrors the expected ordered (name, bib, roster) tuples.</summary>
    private static bool LineupMatches(KickoffLineup lineup, IReadOnlyList<(string Name, bool Bib, List<Guid> Roster)> expected)
    {
        if (lineup.Teams.Count != expected.Count)
        {
            return false;
        }

        for (var i = 0; i < expected.Count; i++)
        {
            var team = lineup.Teams[i];
            if (team.TeamName != expected[i].Name
                || team.BibFlag != expected[i].Bib
                || !team.ParticipantMembershipIds.SequenceEqual(expected[i].Roster))
            {
                return false;
            }
        }

        return true;
    }

    /// <summary>
    /// Creates a match drafted for <paramref name="squadId"/> and confirmed with an empty participant
    /// pool, leaving it in <see cref="MatchState.Confirmed"/> ready for participants and team rolling.
    /// </summary>
    private static Match ConfirmedMatch(Guid squadId)
    {
        var day = NowUtc.AddDays(7);
        var match = Match.CreateDraft(Guid.Empty, squadId, "Community Astro Pitch", [day], NowUtc).Value!;
        match.Confirm(day, availableCount: 0, minimumThreshold: 0, activeRegisteredMembers: []);
        return match;
    }

    // ---- Generators -----------------------------------------------------------------------------

    /// <summary>A generated lock scenario: the two teams' sizes, names, and bib flags.</summary>
    private sealed record Scenario(int SizeA, int SizeB, string NameA, string NameB, bool BibA, bool BibB);

    /// <summary>
    /// Generates two team sizes in 3..10 (straddling the 5..8 valid range so both accept and reject
    /// paths occur), two names drawn from a pool exercising valid, empty, whitespace, over-length, and
    /// case-insensitively duplicate values, and two independent bib flags exercising zero, one, and two
    /// flags set.
    /// </summary>
    private static Gen<Scenario> ScenarioGen() =>
        from sizeA in Gen.Choose(3, 10)
        from sizeB in Gen.Choose(3, 10)
        from nameA in NameGen()
        from nameB in NameGen()
        from bibA in Gen.Elements(true, false)
        from bibB in Gen.Elements(true, false)
        select new Scenario(sizeA, sizeB, nameA, nameB, bibA, bibB);

    /// <summary>
    /// Generates a team name from a pool spanning valid names, a case variant of a valid name (to drive
    /// case-insensitive duplicate rejection), an empty and a whitespace-only name (invalid length), and
    /// an over-length name (invalid length).
    /// </summary>
    private static Gen<string> NameGen() =>
        Gen.Elements("Reds", "Blues", "reds", string.Empty, "   ", OverLongName);
}
