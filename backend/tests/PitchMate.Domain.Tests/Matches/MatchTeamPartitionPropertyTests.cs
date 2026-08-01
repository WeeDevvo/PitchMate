using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Domain.Matches;
using PitchMate.Domain.Squads;

namespace PitchMate.Domain.Tests.Matches;

/// <summary>
/// Property-based tests for team assignment partitioning (match-lifecycle design Property 10).
/// <para>
/// For any team proposal or locked team set produced for a match, the match's teams must partition
/// its participants exactly: every participant is assigned to exactly one team, no participant is
/// unassigned, and no participant appears on more than one team — the union of the team rosters
/// equals the participant set with no repeats (Requirement 8.2). Moving a participant between teams
/// preserves this partition (Requirement 8.3).
/// </para>
/// <para>
/// The test drives the behaviour through the <see cref="Match"/> aggregate: a confirmed match is
/// populated with a generated participant pool, a randomly generated two-team assignment is applied
/// via <see cref="Match.ApplyTeamProposal"/>, and then a randomised sequence of
/// <see cref="Match.MoveParticipant"/> operations is performed. The partition invariant is asserted
/// after the proposal is applied and again after every move. The property runs at least 100
/// iterations.
/// </para>
/// </summary>
[Trait("Feature", "match-lifecycle")]
public class MatchTeamPartitionPropertyTests
{
    /// <summary>The clock instant the generated match is drafted against; the candidate day is strictly after it.</summary>
    private static readonly DateTimeOffset NowUtc = new(2025, 1, 1, 0, 0, 0, TimeSpan.Zero);

    // Feature: match-lifecycle, Property 10: Team assignments partition the participants exactly -
    // for any team proposal or locked team set produced for a match, every participant is assigned to
    // exactly one team, no participant is unassigned, and no participant appears on more than one team;
    // moving a participant between teams preserves this partition.
    // Validates: Requirements 8.2, 8.3
    [Property(MaxTest = 100)]
    [Trait("Property", "10")]
    public Property TeamAssignmentsPartitionParticipantsExactly() =>
        Prop.ForAll(Arb.From(ScenarioGen()), scenario =>
        {
            var squadId = Guid.NewGuid();
            var match = ConfirmedMatch(squadId);

            // Populate the participant pool; capture the membership ids in stable order.
            var participantIds = new List<Guid>(scenario.ParticipantCount);
            for (var i = 0; i < scenario.ParticipantCount; i++)
            {
                var membership = SquadMembership.CreateRegistered(squadId, Guid.NewGuid(), $"Player {i}").Value!;
                var added = match.AddParticipant(membership);
                if (!added.IsSuccess)
                {
                    return false;
                }

                participantIds.Add(membership.Id);
            }

            // Build a valid two-team partition from the generated assignment (every participant lands
            // on exactly one team; team sizes may be uneven or empty at proposal time).
            var teamA = new List<Guid>();
            var teamB = new List<Guid>();
            for (var i = 0; i < participantIds.Count; i++)
            {
                (scenario.Assignment[i] == 0 ? teamA : teamB).Add(participantIds[i]);
            }

            var proposal = new List<ProposedTeam>
            {
                new("Reds", BibFlag: true, teamA),
                new("Blues", BibFlag: false, teamB)
            };

            var applied = match.ApplyTeamProposal(proposal);
            if (!applied.IsSuccess || !PartitionHolds(match))
            {
                return false;
            }

            // Every generated move targets a real participant and a real team, so each must succeed
            // and preserve the partition.
            var teamIds = match.Teams.Select(t => t.Id).ToArray();
            foreach (var move in scenario.Moves)
            {
                var membershipId = participantIds[move.ParticipantIndex];
                var targetTeamId = teamIds[move.TargetTeamIndex];

                var moved = match.MoveParticipant(membershipId, targetTeamId);
                if (!moved.IsSuccess)
                {
                    return false;
                }

                // The moved participant is now on the target team and on no other.
                var onTarget = match.Teams.Single(t => t.Id == targetTeamId).Roster.Contains(membershipId);
                var onOthers = match.Teams.Where(t => t.Id != targetTeamId).Any(t => t.Roster.Contains(membershipId));
                if (!onTarget || onOthers || !PartitionHolds(match))
                {
                    return false;
                }
            }

            return true;
        });

    /// <summary>
    /// Verifies the match's teams partition its participants exactly: no participant appears on more
    /// than one team, and the union of all team rosters equals the participant set.
    /// </summary>
    private static bool PartitionHolds(Match match)
    {
        var participantIds = match.Participants.Select(p => p.SquadMembershipId).ToHashSet();
        var assigned = match.Teams.SelectMany(t => t.Roster).ToList();

        // No participant on more than one team.
        if (assigned.Count != assigned.Distinct().Count())
        {
            return false;
        }

        // Union of rosters equals the participant set (no unassigned, no foreign).
        return assigned.Count == participantIds.Count && participantIds.SetEquals(assigned);
    }

    /// <summary>
    /// Creates a match drafted for <paramref name="squadId"/> and confirmed with an empty participant
    /// pool, leaving it in <see cref="MatchState.Confirmed"/> ready for participants to be added and
    /// teams to be rolled.
    /// </summary>
    private static Match ConfirmedMatch(Guid squadId)
    {
        var day = NowUtc.AddDays(7);
        var match = Match.CreateDraft(Guid.Empty, squadId, "Community Astro Pitch", [day], NowUtc).Value!;
        match.Confirm(day, availableCount: 0, minimumThreshold: 0, activeRegisteredMembers: []);
        return match;
    }

    // ---- Generators -----------------------------------------------------------------------------

    /// <summary>A single generated move: the participant (by pool index) to move to a team (by team index 0 or 1).</summary>
    private sealed record MoveSpec(int ParticipantIndex, int TargetTeamIndex);

    /// <summary>A generated scenario: a participant count, a two-team assignment, and a sequence of moves.</summary>
    private sealed record Scenario(int ParticipantCount, int[] Assignment, MoveSpec[] Moves);

    /// <summary>
    /// Generates a pool of 2..16 participants, a valid two-team assignment (each participant assigned
    /// to team 0 or 1, guaranteeing a partition), and a sequence of 0..30 moves, each targeting a real
    /// participant and one of the two teams.
    /// </summary>
    private static Gen<Scenario> ScenarioGen() =>
        from participantCount in Gen.Choose(2, 16)
        from assignment in Gen.ArrayOf(Gen.Choose(0, 1), participantCount)
        from moveCount in Gen.Choose(0, 30)
        from moves in Gen.ArrayOf(MoveSpecGen(participantCount), moveCount)
        select new Scenario(participantCount, assignment, moves);

    /// <summary>Generates one move over a pool of <paramref name="participantCount"/> participants and two teams.</summary>
    private static Gen<MoveSpec> MoveSpecGen(int participantCount) =>
        from participantIndex in Gen.Choose(0, participantCount - 1)
        from targetTeamIndex in Gen.Choose(0, 1)
        select new MoveSpec(participantIndex, targetTeamIndex);
}
