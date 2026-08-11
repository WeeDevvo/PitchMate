using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Domain.LiveTracking;

namespace PitchMate.Domain.Tests.LiveTracking;

/// <summary>
/// Property-based test for the order-independence of the pure <see cref="MatchEventLog"/> projection
/// (live-tracking design Property 9).
/// <para>
/// Every derivation is a pure function of the <em>set</em> of accepted events, with every ordering tie
/// resolved deterministically by <c>Event_Id</c> (Requirement 6.2, 12.1, 12.2, 12.3). Property 9
/// asserts that recording the same events in two different orders — as a client's local queue is
/// synced in arbitrary batch and retry order — yields identical derived values: the same
/// <see cref="MatchEventLog.RetractedEventIds"/>, the same <see cref="MatchEventLog.EffectiveEvents"/>
/// (as an ordered-by-<c>Event_Id</c> sequence, hence also as a set), the same
/// <see cref="MatchEventLog.MatchDurationMinute"/>, the same per-team
/// <see cref="MatchEventLog.ComputeRunningScore"/>, the same <see cref="MatchEventLog.ComputeStints"/>
/// (as a set), the same per-membership <see cref="MatchEventLog.ForMembership"/> figures for every
/// membership in the pool, and the same squad-wide <see cref="MatchEventLog.TopScorer"/>
/// (Requirement 13.2, 13.3).
/// </para>
/// <para>
/// Rather than compare the projection against a re-implemented oracle, this test exploits the
/// projection's own defining relation: derivation is a function of the event <em>set</em>, so a
/// permutation of the log is the natural metamorphic transform that must leave every output invariant.
/// The permutation is an FsCheck-generated shuffle of the very same event instances, so any difference
/// in output can only come from an order dependency in the projection.
/// </para>
/// </summary>
[Trait("Feature", "live-tracking")]
public class OrderIndependencePropertyTests
{
    // Feature: live-tracking, Property 9: Derivation depends only on the effective set and is order-independent
    // For any generated event log and any permutation of that same log, every derived value is identical:
    // RetractedEventIds, EffectiveEvents (ordered by Event_Id, hence as a set), MatchDurationMinute,
    // ComputeRunningScore (per team), ComputeStints (as a set), ForMembership (for each membership in the
    // pool plus a non-participant), and TopScorer. Derivation is a pure function of the effective set with
    // Event_Id tie-breaking, so order across batches / sync order never affects the result.
    // Validates: Requirements 6.2, 12.1, 12.2, 12.3, 13.2, 13.3
    [Property(MaxTest = 100)]
    [Trait("Property", "9")]
    public Property DerivationDependsOnlyOnTheEffectiveSetAndIsOrderIndependent() =>
        Prop.ForAll(Arb.From(ScenariosWithPermutation()), testCase =>
        {
            var (scenario, reordered) = testCase;
            var original = scenario.Events;

            // The permutation is a genuine reordering of the identical event set — same ids, any order.
            if (!reordered.Select(e => e.Id).ToHashSet().SetEquals(original.Select(e => e.Id).ToHashSet()))
            {
                return false;
            }

            // (12.1) The retracted-id set is identical regardless of input order.
            if (!MatchEventLog.RetractedEventIds(original).SetEquals(MatchEventLog.RetractedEventIds(reordered)))
            {
                return false;
            }

            // (6.2, 12.1) The effective events are identical as an ordered-by-Event_Id sequence — the
            // deterministic tie-break — and therefore also as a set.
            if (!EffectiveIdsInOrder(original).SequenceEqual(EffectiveIdsInOrder(reordered)))
            {
                return false;
            }

            // (12.2) The match duration minute is identical regardless of input order.
            if (MatchEventLog.MatchDurationMinute(original) != MatchEventLog.MatchDurationMinute(reordered))
            {
                return false;
            }

            // (6.2) The running score agrees for every team present in either derivation, plus a
            // non-participant team (which must be 0 in both).
            if (!SameRunningScore(scenario, original, reordered))
            {
                return false;
            }

            // (12.2, 12.3) The keeper stints are identical as a set, independent of input order.
            if (!StintsEqualAsSet(MatchEventLog.ComputeStints(original), MatchEventLog.ComputeStints(reordered)))
            {
                return false;
            }

            // (12.3, 13.2) The per-membership rich figures agree for every membership in the pool and for
            // a fresh non-participant (all-zero in both orders).
            var probeMemberships = scenario.Memberships.Append(Guid.CreateVersion7());
            if (probeMemberships.Any(membership =>
                    MatchEventLog.ForMembership(membership, original)
                    != MatchEventLog.ForMembership(membership, reordered)))
            {
                return false;
            }

            // (13.3) The squad-wide top scorer is identical regardless of input order.
            return MatchEventLog.TopScorer(original) == MatchEventLog.TopScorer(reordered);
        });

    /// <summary>
    /// Generates a scenario paired with an FsCheck-shuffled permutation of its own event log — the same
    /// event instances in an arbitrary order, modelling arbitrary batching and retry / sync order.
    /// </summary>
    private static Gen<(MatchEventScenario Scenario, IReadOnlyList<MatchEvent> Reordered)> ScenariosWithPermutation() =>
        from scenario in MatchEventGenerators.Scenarios()
        from shuffled in Gen.Shuffle(scenario.Events.ToArray())
        select (scenario, (IReadOnlyList<MatchEvent>)shuffled);

    /// <summary>The ids of the effective events in the projection's deterministic <c>Event_Id</c> order.</summary>
    private static IReadOnlyList<Guid> EffectiveIdsInOrder(IEnumerable<MatchEvent> events) =>
        MatchEventLog.EffectiveEvents(events).Select(e => e.Id).ToList();

    /// <summary>
    /// Whether the running scores derived from the two orderings agree on every team present in either
    /// derivation and on the scenario's kickoff teams, plus a fresh non-participant team (0 in both).
    /// </summary>
    private static bool SameRunningScore(
        MatchEventScenario scenario,
        IEnumerable<MatchEvent> original,
        IEnumerable<MatchEvent> reordered)
    {
        RunningScore a = MatchEventLog.ComputeRunningScore(original);
        RunningScore b = MatchEventLog.ComputeRunningScore(reordered);

        var teams = a.CountsByTeam.Keys
            .Union(b.CountsByTeam.Keys)
            .Union(scenario.TeamIds)
            .Append(Guid.CreateVersion7());

        return teams.All(team => a.ForTeam(team) == b.ForTeam(team));
    }

    /// <summary>Whether two stint lists are equal as sets, independent of enumeration order.</summary>
    private static bool StintsEqualAsSet(IReadOnlyList<KeeperStint> a, IReadOnlyList<KeeperStint> b)
    {
        static IEnumerable<KeeperStint> Ordered(IReadOnlyList<KeeperStint> stints) => stints
            .OrderBy(s => s.TeamId)
            .ThenBy(s => s.StartMinute)
            .ThenBy(s => s.KeeperMembershipId)
            .ThenBy(s => s.EndMinute);

        return a.Count == b.Count && Ordered(a).SequenceEqual(Ordered(b));
    }
}
