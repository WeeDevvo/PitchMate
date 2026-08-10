using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Domain.LiveTracking;

namespace PitchMate.Domain.Tests.LiveTracking;

/// <summary>
/// Property-based test for the retraction semantics of the pure <see cref="MatchEventLog"/> projection
/// (live-tracking design Property 7) — how <see cref="MatchEventLog.RetractedEventIds"/>,
/// <see cref="MatchEventLog.EffectiveEvents"/>, and the values derived from the effective set
/// (<see cref="MatchEventLog.ComputeRunningScore"/> and <see cref="MatchEventLog.ComputeStints"/>)
/// respond to compensating retraction events.
/// <para>
/// A retraction is <em>matched</em>: it only takes effect when it names a same-match event of the
/// matching kind (<see cref="GoalRetractedEvent"/> → <see cref="GoalScoredEvent"/>,
/// <see cref="KeeperStintRetractedEvent"/> → <see cref="KeeperStintStartedEvent"/>); a retraction naming
/// a non-existent id or a mismatched-kind target is a no-op on the effective set (Requirement 5.3, 5.4),
/// and a retraction is itself never retracted (Requirement 5.6). A retracted event is excluded from the
/// effective set, the running score, and the stints while remaining in the stored log (Requirement 5.2).
/// Retraction is <em>idempotent</em>: a second retraction of an already-retracted target changes
/// nothing (Requirement 5.5). And retraction is <em>compensating</em>: appending a matching retraction
/// for an effective event removes exactly that event's contribution — a metamorphic relation
/// (Requirement 5.1, 1.7).
/// </para>
/// <para>
/// The oracle recomputes the retracted-id set independently of the projection — matching each retraction
/// against the goal/stint ids actually present, of the matching kind — so the property compares
/// <see cref="MatchEventLog"/> against a separate definition rather than against itself. No-op and
/// idempotence probes append retractions carrying minute 0 so they never raise the
/// <see cref="MatchEventLog.MatchDurationMinute"/> and thus isolate the retraction's (non-)effect.
/// </para>
/// </summary>
[Trait("Feature", "live-tracking")]
public class RetractionPropertyTests
{
    // Feature: live-tracking, Property 7: Retractions are compensating, matched, and idempotent
    // A retraction takes effect only when it names a same-match event of the matching kind; naming an
    // absent id, a mismatched-kind target, or another retraction is a no-op (Req 5.3, 5.4, 5.6). A
    // retracted event is excluded from the effective set, running score, and stints while remaining in
    // the stored log (Req 5.2). A repeated retraction of an already-retracted target changes nothing
    // (Req 5.5). Appending a matching retraction for an effective event removes exactly that event's
    // contribution (Req 5.1, 1.7).
    // Validates: Requirements 1.7, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6
    [Property(MaxTest = 100)]
    [Trait("Property", "7")]
    public Property RetractionsAreCompensatingMatchedAndIdempotent() =>
        Prop.ForAll(Arb.From(MatchEventGenerators.Scenarios()), scenario =>
            MatchedRetractionsOnly(scenario)
            && RetractedEventsAreExcludedButRetained(scenario)
            && MismatchedKindTargetsAreNoOps(scenario)
            && AbsentTargetsAreNoOps(scenario)
            && RetractionsAreThemselvesNeverRetracted(scenario)
            && RepeatedRetractionIsIdempotent(scenario)
            && MatchingRetractionRemovesExactlyOneContribution(scenario));

    /// <summary>
    /// (Req 5.1, 5.3, 5.4) The projection's retracted-id set equals the independent oracle: exactly the
    /// goal-scored / keeper-stint-started ids named by an accepted retraction of the matching kind. A
    /// retraction targeting an absent id or a mismatched kind contributes nothing.
    /// </summary>
    private static bool MatchedRetractionsOnly(MatchEventScenario scenario)
    {
        IReadOnlySet<Guid> actual = MatchEventLog.RetractedEventIds(scenario.Events);
        IReadOnlySet<Guid> expected = ExpectedRetractedIds(scenario.Events);
        return actual.SetEquals(expected);
    }

    /// <summary>
    /// (Req 5.2) Every retracted id names an event still present in the stored log yet absent from the
    /// effective set; and every effective event is a non-retracted goal-scored or keeper-stint-started
    /// event.
    /// </summary>
    private static bool RetractedEventsAreExcludedButRetained(MatchEventScenario scenario)
    {
        IReadOnlySet<Guid> retracted = MatchEventLog.RetractedEventIds(scenario.Events);
        var storedIds = scenario.Events.Select(e => e.Id).ToHashSet();
        var effective = MatchEventLog.EffectiveEvents(scenario.Events);
        var effectiveIds = effective.Select(e => e.Id).ToHashSet();

        // Each retracted event remains stored but is excluded from the effective set.
        if (!retracted.All(id => storedIds.Contains(id) && !effectiveIds.Contains(id)))
        {
            return false;
        }

        // The effective set is exactly the non-retracted goal-scored / keeper-stint-started events.
        return effective.All(e =>
            e.Kind is EventKind.GoalScored or EventKind.KeeperStintStarted
            && !retracted.Contains(e.Id));
    }

    /// <summary>
    /// (Req 5.4) A <c>GoalRetracted</c> naming a keeper-stint-started event, or a
    /// <c>KeeperStintRetracted</c> naming a goal-scored event, is a no-op on every derived value.
    /// </summary>
    private static bool MismatchedKindTargetsAreNoOps(MatchEventScenario scenario)
    {
        var goal = scenario.Events.OfType<GoalScoredEvent>().OrderBy(e => e.Id).FirstOrDefault();
        var stint = scenario.Events.OfType<KeeperStintStartedEvent>().OrderBy(e => e.Id).FirstOrDefault();

        var probes = new List<MatchEvent>();
        if (stint is not null)
        {
            // A goal-retraction naming a keeper-stint-started event — a kind mismatch.
            probes.Add(new GoalRetractedEvent(Guid.CreateVersion7(), scenario.MatchId, scenario.SquadId, Zero, stint.Id));
        }

        if (goal is not null)
        {
            // A keeper-stint-retraction naming a goal-scored event — a kind mismatch.
            probes.Add(new KeeperStintRetractedEvent(Guid.CreateVersion7(), scenario.MatchId, scenario.SquadId, Zero, goal.Id));
        }

        return probes.All(probe => SameDerivation(scenario.Events, scenario.Events.Append(probe)));
    }

    /// <summary>
    /// (Req 5.3) A retraction naming a target id that is not present in the match is a no-op on every
    /// derived value, for both retraction kinds.
    /// </summary>
    private static bool AbsentTargetsAreNoOps(MatchEventScenario scenario)
    {
        var strangerForGoal = new GoalRetractedEvent(
            Guid.CreateVersion7(), scenario.MatchId, scenario.SquadId, Zero, Guid.CreateVersion7());
        var strangerForStint = new KeeperStintRetractedEvent(
            Guid.CreateVersion7(), scenario.MatchId, scenario.SquadId, Zero, Guid.CreateVersion7());

        return SameDerivation(scenario.Events, scenario.Events.Append(strangerForGoal))
            && SameDerivation(scenario.Events, scenario.Events.Append(strangerForStint));
    }

    /// <summary>
    /// (Req 5.6) A retraction that names another retraction event as its target is a no-op — a
    /// retraction is itself never retracted, and no retraction event ever appears in the retracted set.
    /// </summary>
    private static bool RetractionsAreThemselvesNeverRetracted(MatchEventScenario scenario)
    {
        IReadOnlySet<Guid> retracted = MatchEventLog.RetractedEventIds(scenario.Events);
        var retractionIds = scenario.Events
            .Where(e => e.Kind is EventKind.GoalRetracted or EventKind.KeeperStintRetracted)
            .Select(e => e.Id)
            .ToHashSet();

        // No retraction event is ever itself retracted.
        if (retractionIds.Any(retracted.Contains))
        {
            return false;
        }

        // Naming an existing retraction event as a target is a no-op for either retraction kind.
        var existingRetraction = scenario.Events
            .FirstOrDefault(e => e.Kind is EventKind.GoalRetracted or EventKind.KeeperStintRetracted);
        if (existingRetraction is null)
        {
            return true;
        }

        var targetingRetraction = new GoalRetractedEvent(
            Guid.CreateVersion7(), scenario.MatchId, scenario.SquadId, Zero, existingRetraction.Id);

        return SameDerivation(scenario.Events, scenario.Events.Append(targetingRetraction));
    }

    /// <summary>
    /// (Req 5.5) Retracting an already-retracted target a second time is idempotent: it changes neither
    /// the retracted-id set, the effective set, the running score, nor the stints.
    /// </summary>
    private static bool RepeatedRetractionIsIdempotent(MatchEventScenario scenario)
    {
        IReadOnlySet<Guid> retracted = MatchEventLog.RetractedEventIds(scenario.Events);
        if (retracted.Count == 0)
        {
            return true;
        }

        // A deterministic already-retracted target and a fresh retraction of the matching kind for it.
        var targetId = retracted.OrderBy(id => id).First();
        var target = scenario.Events.First(e => e.Id == targetId);

        MatchEvent second = target is GoalScoredEvent
            ? new GoalRetractedEvent(Guid.CreateVersion7(), scenario.MatchId, scenario.SquadId, Zero, targetId)
            : new KeeperStintRetractedEvent(Guid.CreateVersion7(), scenario.MatchId, scenario.SquadId, Zero, targetId);

        return SameDerivation(scenario.Events, scenario.Events.Append(second));
    }

    /// <summary>
    /// (Req 5.1, 1.7) The compensating, metamorphic relation: appending a matching retraction for a
    /// currently effective goal or keeper stint removes exactly that one event from the effective set and
    /// adds exactly its id to the retracted set, leaving all other effective events in place; for a goal
    /// it drops exactly its scoring team's running score by one and leaves every other team unchanged.
    /// </summary>
    private static bool MatchingRetractionRemovesExactlyOneContribution(MatchEventScenario scenario)
    {
        var effective = MatchEventLog.EffectiveEvents(scenario.Events);

        var goal = effective.OfType<GoalScoredEvent>().OrderBy(e => e.Id).FirstOrDefault();
        if (goal is not null && !CompensatesGoal(scenario, goal))
        {
            return false;
        }

        var stint = effective.OfType<KeeperStintStartedEvent>().OrderBy(e => e.Id).FirstOrDefault();
        if (stint is not null && !CompensatesEvent(scenario, stint,
                new KeeperStintRetractedEvent(Guid.CreateVersion7(), scenario.MatchId, scenario.SquadId, stint.Minute, stint.Id)))
        {
            return false;
        }

        return true;
    }

    /// <summary>Retracting an effective goal removes it from the effective set and drops exactly its team by one.</summary>
    private static bool CompensatesGoal(MatchEventScenario scenario, GoalScoredEvent goal)
    {
        RunningScore before = MatchEventLog.ComputeRunningScore(scenario.Events);
        var retraction = new GoalRetractedEvent(
            Guid.CreateVersion7(), scenario.MatchId, scenario.SquadId, goal.Minute, goal.Id);

        if (!CompensatesEvent(scenario, goal, retraction))
        {
            return false;
        }

        RunningScore after = MatchEventLog.ComputeRunningScore(scenario.Events.Append(retraction));

        // The scoring team drops by exactly one; every other team is unchanged.
        if (after.ForTeam(goal.ScoringTeamId) != before.ForTeam(goal.ScoringTeamId) - 1)
        {
            return false;
        }

        var otherTeams = before.CountsByTeam.Keys
            .Union(after.CountsByTeam.Keys)
            .Where(team => team != goal.ScoringTeamId);
        return otherTeams.All(team => after.ForTeam(team) == before.ForTeam(team));
    }

    /// <summary>
    /// The shared metamorphic check: the matching <paramref name="retraction"/> for effective
    /// <paramref name="target"/> adds exactly the target to the retracted set and removes exactly the
    /// target from the effective set, leaving all other effective ids in place.
    /// </summary>
    private static bool CompensatesEvent(MatchEventScenario scenario, MatchEvent target, MatchEvent retraction)
    {
        var beforeEffective = MatchEventLog.EffectiveEvents(scenario.Events).Select(e => e.Id).ToHashSet();
        IReadOnlySet<Guid> beforeRetracted = MatchEventLog.RetractedEventIds(scenario.Events);

        var withRetraction = scenario.Events.Append(retraction).ToList();
        var afterEffective = MatchEventLog.EffectiveEvents(withRetraction).Select(e => e.Id).ToHashSet();
        IReadOnlySet<Guid> afterRetracted = MatchEventLog.RetractedEventIds(withRetraction);

        // The target leaves the effective set; nothing else changes.
        if (!afterEffective.SetEquals(beforeEffective.Where(id => id != target.Id)))
        {
            return false;
        }

        // The target joins the retracted set; nothing else changes; the target is still stored.
        var expectedRetracted = new HashSet<Guid>(beforeRetracted) { target.Id };
        return afterRetracted.SetEquals(expectedRetracted)
            && withRetraction.Any(e => e.Id == target.Id);
    }

    /// <summary>
    /// The independent oracle for <see cref="MatchEventLog.RetractedEventIds"/>: exactly the goal-scored
    /// ids named by a goal-retraction, plus the keeper-stint-started ids named by a keeper-stint
    /// retraction, considering only targets of the matching kind that are actually present.
    /// </summary>
    private static IReadOnlySet<Guid> ExpectedRetractedIds(IEnumerable<MatchEvent> events)
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

        return retracted;
    }

    /// <summary>
    /// Whether two logs yield identical derivations: the same retracted-id set, effective set, running
    /// score, and keeper stints. Used to assert that a no-op retraction changes nothing.
    /// </summary>
    private static bool SameDerivation(IEnumerable<MatchEvent> before, IEnumerable<MatchEvent> after)
    {
        var beforeList = before as IReadOnlyCollection<MatchEvent> ?? before.ToList();
        var afterList = after as IReadOnlyCollection<MatchEvent> ?? after.ToList();

        if (!MatchEventLog.RetractedEventIds(beforeList).SetEquals(MatchEventLog.RetractedEventIds(afterList)))
        {
            return false;
        }

        var beforeEffective = MatchEventLog.EffectiveEvents(beforeList).Select(e => e.Id).ToHashSet();
        var afterEffective = MatchEventLog.EffectiveEvents(afterList).Select(e => e.Id).ToHashSet();
        if (!beforeEffective.SetEquals(afterEffective))
        {
            return false;
        }

        if (!SameRunningScore(MatchEventLog.ComputeRunningScore(beforeList), MatchEventLog.ComputeRunningScore(afterList)))
        {
            return false;
        }

        return StintsEqual(MatchEventLog.ComputeStints(beforeList), MatchEventLog.ComputeStints(afterList));
    }

    /// <summary>Whether two running scores agree on every team present in either.</summary>
    private static bool SameRunningScore(RunningScore a, RunningScore b) =>
        a.CountsByTeam.Keys.Union(b.CountsByTeam.Keys).All(team => a.ForTeam(team) == b.ForTeam(team));

    /// <summary>Whether two stint lists are equal as sets, independent of enumeration order.</summary>
    private static bool StintsEqual(IReadOnlyList<KeeperStint> a, IReadOnlyList<KeeperStint> b)
    {
        static IEnumerable<KeeperStint> Ordered(IReadOnlyList<KeeperStint> stints) => stints
            .OrderBy(s => s.TeamId)
            .ThenBy(s => s.StartMinute)
            .ThenBy(s => s.KeeperMembershipId)
            .ThenBy(s => s.EndMinute);

        return Ordered(a).SequenceEqual(Ordered(b));
    }

    /// <summary>A valid minute 0 used by no-op probes so they never raise the match duration minute.</summary>
    private static MatchMinute Zero => MatchMinute.Create(0).Value!;
}
