using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Domain.LiveTracking;

namespace PitchMate.Domain.Tests.LiveTracking;

/// <summary>
/// Property-based test for goals scored, own-goal exclusion, and top-scorer derivation by the pure
/// <see cref="MatchEventLog"/> projection — <see cref="MatchEventLog.ForMembership"/> (the
/// <see cref="MatchRichStatistics.Goals"/> figure) and <see cref="MatchEventLog.TopScorer"/>
/// (live-tracking design Property 15).
/// <para>
/// A membership's goals are the count of <em>effective</em> (accepted, non-retracted)
/// <see cref="GoalScoredEvent"/>s crediting it as scorer that are <em>not</em> own goals: an own goal
/// still counts in the running score but is never credited to the scorer's goal tally (Requirement
/// 3.4, 10.2). The top scorer is the membership with the greatest such goal count across the pooled
/// events, or none when no effective non-own-goal credited goal exists (Requirement 10.6).
/// </para>
/// <para>
/// The oracle recomputes the credited-goal counts independently of the projection — filtering the
/// non-retracted goal-scored events to those that name a scorer and are not own goals, then grouping
/// by scorer — so the property compares <see cref="MatchEventLog"/> against a separate definition
/// rather than against itself. Because <see cref="MatchEventLog.TopScorer"/> pools events across
/// matches and keys on globally-unique <c>Event_Id</c>s, the single scenario's event log is used as
/// the pool.
/// </para>
/// </summary>
[Trait("Feature", "live-tracking")]
public class GoalsAndTopScorerPropertyTests
{
    // Feature: live-tracking, Property 15: Goals scored, own goals, and top scorer
    // A membership's ForMembership(...).Goals equals the count of effective (accepted, non-retracted)
    // non-own-goal GoalScored events crediting it as scorer; own goals are excluded. TopScorer is the
    // membership with the greatest such count (a maximum, tie-broken by smallest membership id), or null
    // when no effective non-own-goal credited goal exists.
    // Validates: Requirements 3.4, 10.1, 10.2, 10.6
    [Property(MaxTest = 100)]
    [Trait("Property", "15")]
    public Property GoalsExcludeOwnGoalsAndTopScorerIsTheMaximum() =>
        Prop.ForAll(Arb.From(MatchEventGenerators.Scenarios()), scenario =>
        {
            var events = scenario.Events;

            // Independent oracle: credited (non-own-goal, scorer-named) effective goals grouped by scorer.
            IReadOnlyDictionary<Guid, int> creditedByScorer = CreditedGoalsByScorer(events);

            // (3.4, 10.2) Each membership's Goals equals its count of effective, non-own-goal credited goals.
            foreach (var membership in scenario.Memberships)
            {
                var stats = MatchEventLog.ForMembership(membership, events);
                if (stats.Goals != creditedByScorer.GetValueOrDefault(membership, 0))
                {
                    return false;
                }
            }

            // (3.4) An own goal never credits its scorer: a membership that only ever scored own goals
            // has zero Goals, even though its own goals still counted toward the running score.
            if (!OwnGoalsAreExcludedFromScorerGoals(scenario, creditedByScorer))
            {
                return false;
            }

            // (10.6) The top scorer is the maximum over credited goals, or null when none exists.
            return TopScorerIsTheMaximum(events, creditedByScorer);
        });

    /// <summary>
    /// Asserts that every membership which scored only own goals (and never a credited goal) is reported
    /// with zero <see cref="MatchRichStatistics.Goals"/>, confirming own goals are excluded from the
    /// scorer's goal tally even while they count in the running score (Requirement 3.4).
    /// </summary>
    private static bool OwnGoalsAreExcludedFromScorerGoals(
        MatchEventScenario scenario,
        IReadOnlyDictionary<Guid, int> creditedByScorer)
    {
        var effectiveGoals = EffectiveGoals(scenario.Events);

        var ownGoalScorers = effectiveGoals
            .Where(g => g.OwnGoal && g.ScorerMembershipId is Guid)
            .Select(g => g.ScorerMembershipId!.Value)
            .Where(scorer => !creditedByScorer.ContainsKey(scorer))
            .Distinct();

        return ownGoalScorers.All(scorer => MatchEventLog.ForMembership(scorer, scenario.Events).Goals == 0);
    }

    /// <summary>
    /// The top-scorer relation (Requirement 10.6): when no effective non-own-goal credited goal exists
    /// the projection returns <see langword="null"/>; otherwise it returns a membership whose goal count
    /// is a maximum (greater than or equal to every membership's goal count) and, on a tie, the smallest
    /// membership id — the projection's deterministic tie-break.
    /// </summary>
    private static bool TopScorerIsTheMaximum(
        IEnumerable<MatchEvent> events,
        IReadOnlyDictionary<Guid, int> creditedByScorer)
    {
        Guid? topScorer = MatchEventLog.TopScorer(events);

        if (creditedByScorer.Count == 0)
        {
            // No effective non-own-goal credited goal exists: there is no top scorer.
            return topScorer is null;
        }

        if (topScorer is not Guid winner)
        {
            return false;
        }

        // The winner must actually have credited goals.
        if (!creditedByScorer.TryGetValue(winner, out var winnerGoals) || winnerGoals == 0)
        {
            return false;
        }

        // (maximum) No other scorer has more credited goals than the winner.
        if (creditedByScorer.Values.Any(count => count > winnerGoals))
        {
            return false;
        }

        // (deterministic tie-break) Among the memberships sharing the maximum count, the winner is the
        // smallest membership id.
        var expectedWinner = creditedByScorer
            .Where(pair => pair.Value == winnerGoals)
            .Select(pair => pair.Key)
            .OrderBy(id => id)
            .First();

        return winner == expectedWinner;
    }

    /// <summary>
    /// The independent oracle: the count of effective (non-retracted), non-own-goal goals crediting each
    /// scorer. A goal contributes only when it names a scorer and is not an own goal (Requirement 10.2).
    /// </summary>
    private static IReadOnlyDictionary<Guid, int> CreditedGoalsByScorer(IEnumerable<MatchEvent> events) =>
        EffectiveGoals(events)
            .Where(goal => !goal.OwnGoal && goal.ScorerMembershipId is Guid)
            .GroupBy(goal => goal.ScorerMembershipId!.Value)
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
