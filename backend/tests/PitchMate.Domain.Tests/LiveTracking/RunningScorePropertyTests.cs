using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Domain.LiveTracking;

namespace PitchMate.Domain.Tests.LiveTracking;

/// <summary>
/// Property-based test for the running score derived by <see cref="MatchEventLog.ComputeRunningScore"/>
/// (live-tracking design Property 8).
/// <para>
/// The running score is a pure function of the <em>effective</em> events — the accepted
/// <see cref="GoalScoredEvent"/>s that are not retracted. Property 8 asserts that, for any generated
/// event log, each kickoff team's running score equals the count of that team's effective goals
/// (Requirement 6.1); a team with no effective goals reports 0 (Requirement 6.4); no team's score is
/// ever negative (Requirement 6.5); and retracting one effective goal reduces exactly its scoring
/// team's tally by one and leaves every other team's tally unchanged (Requirement 6.3) — the
/// compensating, metamorphic relationship.
/// </para>
/// <para>
/// The oracle recomputes the effective-goal counts independently of the projection — grouping the
/// non-retracted <see cref="GoalScoredEvent"/>s by scoring team — so the property compares
/// <see cref="MatchEventLog"/> against a separate definition rather than against itself.
/// </para>
/// </summary>
[Trait("Feature", "live-tracking")]
public class RunningScorePropertyTests
{
    // Feature: live-tracking, Property 8: Running score equals effective goals per team and never goes negative
    // ComputeRunningScore(events).ForTeam(team) equals the count of that team's effective (accepted,
    // non-retracted) GoalScored events; it is 0 for a team with no effective goals; it is never
    // negative; and retracting a goal reduces its team's score by exactly one (metamorphic).
    // Validates: Requirements 6.1, 6.3, 6.4, 6.5
    [Property(MaxTest = 100)]
    [Trait("Property", "8")]
    public Property RunningScoreEqualsEffectiveGoalsPerTeamAndNeverNegative() =>
        Prop.ForAll(Arb.From(MatchEventGenerators.Scenarios()), scenario =>
        {
            var events = scenario.Events;
            RunningScore score = MatchEventLog.ComputeRunningScore(events);

            // Independent oracle: a goal is effective when no retraction of the matching kind targets it.
            IReadOnlyDictionary<Guid, int> expectedByTeam = ExpectedGoalsByTeam(events);

            // (6.1) Each team's running score equals its count of effective goals.
            foreach (var team in scenario.TeamIds)
            {
                if (score.ForTeam(team) != expectedByTeam.GetValueOrDefault(team, 0))
                {
                    return false;
                }
            }

            // (6.4) A team with no effective goals reports 0 — here an unrelated fresh team id.
            if (score.ForTeam(Guid.CreateVersion7()) != 0)
            {
                return false;
            }

            // (6.5) No team's score is ever negative, for any team or any map entry.
            if (score.CountsByTeam.Values.Any(count => count < 0))
            {
                return false;
            }

            if (scenario.TeamIds.Any(team => score.ForTeam(team) < 0))
            {
                return false;
            }

            // (6.3) Retracting one effective goal reduces exactly its team's tally by one.
            return RetractingAGoalReducesItsTeamByExactlyOne(scenario, score);
        });

    /// <summary>
    /// The metamorphic relation: appending a <see cref="GoalRetractedEvent"/> that targets a currently
    /// effective goal reduces that goal's scoring team's running score by exactly one and leaves every
    /// other team's running score unchanged (Requirement 6.3). A no-op when the log has no effective
    /// goal to retract.
    /// </summary>
    private static bool RetractingAGoalReducesItsTeamByExactlyOne(MatchEventScenario scenario, RunningScore before)
    {
        var effectiveGoals = EffectiveGoals(scenario.Events);
        if (effectiveGoals.Count == 0)
        {
            return true;
        }

        // Pick a deterministic effective goal to retract.
        var goal = effectiveGoals.OrderBy(g => g.Id).First();

        var retraction = new GoalRetractedEvent(
            Guid.CreateVersion7(),
            scenario.MatchId,
            scenario.SquadId,
            goal.Minute,
            goal.Id);

        RunningScore after = MatchEventLog.ComputeRunningScore(scenario.Events.Append(retraction));

        // The scoring team drops by exactly one.
        if (after.ForTeam(goal.ScoringTeamId) != before.ForTeam(goal.ScoringTeamId) - 1)
        {
            return false;
        }

        // Every other team is unchanged.
        return scenario.TeamIds
            .Where(team => team != goal.ScoringTeamId)
            .All(team => after.ForTeam(team) == before.ForTeam(team));
    }

    /// <summary>
    /// The independent oracle: the count of effective (non-retracted) goals per scoring team. A goal is
    /// retracted when at least one <see cref="GoalRetractedEvent"/> in the log names its id.
    /// </summary>
    private static IReadOnlyDictionary<Guid, int> ExpectedGoalsByTeam(IEnumerable<MatchEvent> events) =>
        EffectiveGoals(events)
            .GroupBy(goal => goal.ScoringTeamId)
            .ToDictionary(group => group.Key, group => group.Count());

    /// <summary>The accepted goal-scored events that no goal-retraction names — the effective goals.</summary>
    private static IReadOnlyList<GoalScoredEvent> EffectiveGoals(IEnumerable<MatchEvent> events)
    {
        var materialised = events as IReadOnlyCollection<MatchEvent> ?? events.ToList();

        var goals = materialised.OfType<GoalScoredEvent>().ToList();
        var goalIds = goals.Select(g => g.Id).ToHashSet();

        var retractedGoalIds = materialised
            .OfType<GoalRetractedEvent>()
            .Select(retraction => retraction.TargetEventId)
            .Where(goalIds.Contains)
            .ToHashSet();

        return goals.Where(goal => !retractedGoalIds.Contains(goal.Id)).ToList();
    }
}
