using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Domain.LiveTracking;

namespace PitchMate.Domain.Tests.LiveTracking;

/// <summary>
/// Property-based test for goals-conceded-as-keeper, clean sheets, and keeper time derived by the pure
/// <see cref="MatchEventLog"/> projection — <see cref="MatchEventLog.ForMembership"/> (the
/// <see cref="MatchRichStatistics.ConcededAsKeeper"/>, <see cref="MatchRichStatistics.KeeperMinutes"/>,
/// and <see cref="MatchRichStatistics.KeptAnyStint"/> figures) (live-tracking design Property 16).
/// <para>
/// For any generated event log and any membership, the projection's keeper figures must agree with an
/// independent oracle built from the <em>same</em> active-keeper-at-minute semantics:
/// </para>
/// <list type="bullet">
/// <item><see cref="MatchRichStatistics.KeeperMinutes"/> equals the sum, over that membership's
/// effective stints, of each stint's whole-minute duration (Requirement 10.5).</item>
/// <item><see cref="MatchRichStatistics.ConcededAsKeeper"/> equals the count of effective goals credited
/// to a team <em>other</em> than the keeper's kept team whose minute falls within one of that
/// membership's stints for the scored-against team, attributing each goal to the keeper on the pitch for
/// that team at the goal's minute (the effective stint with the greatest start minute at or before the
/// goal) (Requirement 10.3).</item>
/// <item>A clean-sheet basis holds — <see cref="MatchRichStatistics.KeptAnyStint"/> is <c>true</c> and
/// <see cref="MatchRichStatistics.ConcededAsKeeper"/> is 0 — exactly when the membership kept one or
/// more effective stints and conceded zero across them; a membership that kept no stint has
/// <see cref="MatchRichStatistics.KeptAnyStint"/> <c>false</c> (not a clean sheet) (Requirement
/// 10.4).</item>
/// <item>Consistency: <see cref="MatchRichStatistics.KeptAnyStint"/> is <c>true</c> iff the membership
/// has at least one effective stint; when <c>false</c>, both <see cref="MatchRichStatistics.KeeperMinutes"/>
/// and <see cref="MatchRichStatistics.ConcededAsKeeper"/> are 0.</item>
/// </list>
/// <para>
/// The oracle recomputes the resolved stints and the goal attribution independently of the projection —
/// filtering to effective keeper-stint-started events, resolving same-start-minute collisions by
/// greatest <c>Event_Id</c>, chaining each start minute to the next (or to the match duration minute),
/// and attributing each opposing goal to the active stint at its minute — so the property compares
/// <see cref="MatchEventLog"/> against a separate definition rather than against itself.
/// </para>
/// </summary>
[Trait("Feature", "live-tracking")]
public class KeeperStatsPropertyTests
{
    // Feature: live-tracking, Property 16: Goals conceded as keeper, clean sheets, and keeper time
    // For any generated event log and any membership: KeeperMinutes equals the sum of that membership's
    // effective stint durations (Req 10.5); ConcededAsKeeper equals the count of effective goals credited
    // to a team other than the keeper's kept team whose minute is attributed (greatest start <= goal
    // minute) to one of that membership's stints (Req 10.3); a clean-sheet basis (KeptAnyStint == true &&
    // ConcededAsKeeper == 0) holds exactly when the membership kept >= 1 stint and conceded zero, and a
    // membership that kept no stint is not a clean sheet (Req 10.4); KeptAnyStint is true iff the
    // membership has >= 1 effective stint, and when false KeeperMinutes and ConcededAsKeeper are 0.
    // Validates: Requirements 10.3, 10.4, 10.5
    [Property(MaxTest = 100)]
    [Trait("Property", "16")]
    public Property KeeperConcessionsCleanSheetsAndKeeperTimeMatchTheOracle() =>
        Prop.ForAll(Arb.From(MatchEventGenerators.Scenarios()), scenario =>
        {
            var events = scenario.Events;

            // Independent oracle: per team, the effective resolved stints as contiguous intervals.
            var resolvedByTeam = ResolvedStintsByTeam(events);
            var allStints = resolvedByTeam.Values.SelectMany(s => s).ToList();
            var effectiveGoals = EffectiveGoals(events);

            foreach (var membership in scenario.Memberships)
            {
                var stats = MatchEventLog.ForMembership(membership, events);

                var myStints = allStints.Where(s => s.Keeper == membership).ToList();

                // (consistency) KeptAnyStint is true iff the membership kept >= 1 effective stint.
                if (stats.KeptAnyStint != (myStints.Count > 0))
                {
                    return false;
                }

                // (10.5) KeeperMinutes equals the sum of this membership's stint durations.
                var expectedMinutes = myStints.Sum(s => s.EndMinute - s.StartMinute);
                if (stats.KeeperMinutes != expectedMinutes)
                {
                    return false;
                }

                // (10.3) ConcededAsKeeper equals the count of effective opposing goals attributed to one
                // of this membership's stints via active-keeper-at-minute for the scored-against team.
                var expectedConceded = ExpectedConcededAsKeeper(membership, effectiveGoals, resolvedByTeam);
                if (stats.ConcededAsKeeper != expectedConceded)
                {
                    return false;
                }

                if (myStints.Count == 0)
                {
                    // (consistency) A membership that kept no stint concedes nothing and keeps no time,
                    // and is not a clean sheet.
                    if (stats.ConcededAsKeeper != 0 || stats.KeeperMinutes != 0 || stats.KeptAnyStint)
                    {
                        return false;
                    }
                }

                // (10.4) The clean-sheet basis holds exactly when the membership kept >= 1 stint and
                // conceded zero across those stints.
                var expectedCleanSheet = myStints.Count > 0 && expectedConceded == 0;
                var actualCleanSheet = stats.KeptAnyStint && stats.ConcededAsKeeper == 0;
                if (actualCleanSheet != expectedCleanSheet)
                {
                    return false;
                }
            }

            return true;
        });

    /// <summary>
    /// The independent goal-attribution oracle (Requirement 10.3): the count of effective goals credited
    /// to a team other than one of <paramref name="membership"/>'s kept teams, whose minute is attributed
    /// — by the greatest stint start minute at or before the goal — to a stint kept by that membership for
    /// the scored-against team. Mirrors the projection's per-stint attribution, so a membership keeping
    /// more than one team at a shared minute concedes for each.
    /// </summary>
    private static int ExpectedConcededAsKeeper(
        Guid membership,
        IReadOnlyList<GoalScoredEvent> effectiveGoals,
        IReadOnlyDictionary<Guid, IReadOnlyList<ResolvedStint>> resolvedByTeam)
    {
        var conceded = 0;

        foreach (var (teamId, teamStints) in resolvedByTeam)
        {
            foreach (var goal in effectiveGoals)
            {
                // A goal conceded by this team is one credited to any other (opposing) team.
                if (goal.ScoringTeamId == teamId)
                {
                    continue;
                }

                var minute = goal.Minute.Value;

                // The keeper on the pitch for the scored-against team at the goal's minute is the stint
                // with the greatest start minute at or before it (Requirement 4.2, 4.6).
                ResolvedStint? active = teamStints
                    .Where(s => s.StartMinute <= minute)
                    .OrderByDescending(s => s.StartMinute)
                    .Cast<ResolvedStint?>()
                    .FirstOrDefault();

                if (active is { } stint && stint.Keeper == membership)
                {
                    conceded++;
                }
            }
        }

        return conceded;
    }

    /// <summary>
    /// The independent oracle: per kept team, the effective keeper stints resolved into contiguous
    /// intervals. Retracted stints are excluded; among effective stints sharing a start minute for a team,
    /// only the one with the greatest <c>Event_Id</c> survives (Requirement 4.6); the survivors are
    /// ordered by start minute and each runs to the next start minute, or to the match duration minute
    /// when none follows (Requirement 4.2).
    /// </summary>
    private static IReadOnlyDictionary<Guid, IReadOnlyList<ResolvedStint>> ResolvedStintsByTeam(
        IEnumerable<MatchEvent> events)
    {
        var materialised = events as IReadOnlyCollection<MatchEvent> ?? events.ToList();
        var durationMinute = ExpectedMatchDurationMinute(materialised);
        var effectiveStints = EffectiveStints(materialised);

        return effectiveStints
            .GroupBy(s => s.KeptTeamId)
            .ToDictionary(
                teamGroup => teamGroup.Key,
                teamGroup =>
                {
                    var resolved = teamGroup
                        .GroupBy(s => s.Minute.Value)
                        .Select(startGroup => startGroup.OrderByDescending(s => s.Id).First())
                        .OrderBy(s => s.Minute.Value)
                        .ToList();

                    var intervals = new List<ResolvedStint>();
                    for (var i = 0; i < resolved.Count; i++)
                    {
                        var start = resolved[i].Minute.Value;
                        var end = i + 1 < resolved.Count ? resolved[i + 1].Minute.Value : durationMinute;
                        intervals.Add(new ResolvedStint(teamGroup.Key, resolved[i].KeeperMembershipId, start, end));
                    }

                    return (IReadOnlyList<ResolvedStint>)intervals;
                });
    }

    /// <summary>The accepted keeper-stint-started events that no keeper-stint-retraction names.</summary>
    private static IReadOnlyList<KeeperStintStartedEvent> EffectiveStints(IEnumerable<MatchEvent> events)
    {
        var materialised = events as IReadOnlyCollection<MatchEvent> ?? events.ToList();

        var stints = materialised.OfType<KeeperStintStartedEvent>().ToList();
        var stintIds = stints.Select(s => s.Id).ToHashSet();

        var retractedStintIds = materialised
            .OfType<KeeperStintRetractedEvent>()
            .Select(retraction => retraction.TargetEventId)
            .Where(stintIds.Contains)
            .ToHashSet();

        return stints.Where(stint => !retractedStintIds.Contains(stint.Id)).ToList();
    }

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

    /// <summary>
    /// The independent match-duration minute: the greatest minute among the log's non-retracted events
    /// (retraction events themselves are never retracted, so their minutes count), or 0 when none exist.
    /// </summary>
    private static int ExpectedMatchDurationMinute(IEnumerable<MatchEvent> events)
    {
        var materialised = events as IReadOnlyCollection<MatchEvent> ?? events.ToList();

        var goalIds = materialised.OfType<GoalScoredEvent>().Select(g => g.Id).ToHashSet();
        var stintIds = materialised.OfType<KeeperStintStartedEvent>().Select(s => s.Id).ToHashSet();

        var retracted = new HashSet<Guid>();
        foreach (var e in materialised)
        {
            switch (e)
            {
                case GoalRetractedEvent gr when goalIds.Contains(gr.TargetEventId):
                    retracted.Add(gr.TargetEventId);
                    break;
                case KeeperStintRetractedEvent sr when stintIds.Contains(sr.TargetEventId):
                    retracted.Add(sr.TargetEventId);
                    break;
            }
        }

        var nonRetracted = materialised.Where(e => !retracted.Contains(e.Id)).ToList();
        return nonRetracted.Count == 0 ? 0 : nonRetracted.Max(e => e.Minute.Value);
    }

    /// <summary>An oracle-resolved effective stint: its team, keeper, and contiguous interval bounds.</summary>
    private readonly record struct ResolvedStint(Guid TeamId, Guid Keeper, int StartMinute, int EndMinute);
}
