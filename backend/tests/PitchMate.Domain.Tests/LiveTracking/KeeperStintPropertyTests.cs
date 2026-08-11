using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Domain.LiveTracking;

namespace PitchMate.Domain.Tests.LiveTracking;

/// <summary>
/// Property-based test for the keeper stints derived by <see cref="MatchEventLog.ComputeStints"/>
/// (live-tracking design Property 6).
/// <para>
/// The keeper stints are a pure function of the <em>effective</em> events — the accepted
/// <see cref="KeeperStintStartedEvent"/>s that are not retracted. Property 6 asserts that, for any
/// generated event log and any team, the team's effective stints (ordered by <c>(start minute,
/// Event_Id)</c>) partition time with at most one keeper in goal at any minute: each stint's
/// <see cref="KeeperStint.EndMinute"/> equals the next effective stint's start minute for the same
/// team, the final stint's <see cref="KeeperStint.EndMinute"/> equals the
/// <see cref="MatchEventLog.MatchDurationMinute"/> (Requirement 4.2); and when two or more effective
/// stints for the same team share a start minute, only the one with the greatest <c>Event_Id</c> is
/// effective from that minute, so at no minute is more than one keeper in goal for a team
/// (Requirement 4.6). Retracted stints are excluded.
/// </para>
/// <para>
/// The oracle recomputes the resolved stints independently of the projection — filtering to effective
/// keeper-stint-started events, resolving same-start-minute collisions by greatest <c>Event_Id</c>,
/// and chaining each start minute to the next — so the property compares <see cref="MatchEventLog"/>
/// against a separate definition rather than against itself.
/// </para>
/// </summary>
[Trait("Feature", "live-tracking")]
public class KeeperStintPropertyTests
{
    // Feature: live-tracking, Property 6: Keeper-stint intervals partition time with at most one keeper per team
    // For each team, the effective keeper stints (as computed by ComputeStints) ordered by start minute
    // are contiguous and non-overlapping: each stint's EndMinute equals the next stint's StartMinute,
    // and the final stint's EndMinute equals MatchDurationMinute (Requirement 4.2); when two effective
    // stints for the same team share a start minute, the one with the greatest Event_Id wins
    // (Requirement 4.6); retracted stints are excluded.
    // Validates: Requirements 4.2, 4.6
    [Property(MaxTest = 100)]
    [Trait("Property", "6")]
    public Property KeeperStintIntervalsPartitionTimeWithAtMostOneKeeperPerTeam() =>
        Prop.ForAll(Arb.From(MatchEventGenerators.Scenarios()), scenario =>
        {
            var events = scenario.Events;
            IReadOnlyList<KeeperStint> stints = MatchEventLog.ComputeStints(events);

            var durationMinute = ExpectedMatchDurationMinute(events);

            // Independent oracle: per team, the effective resolved stints ordered by start minute.
            IReadOnlyDictionary<Guid, IReadOnlyList<ResolvedStint>> expectedByTeam = ExpectedStintsByTeam(events);

            // Every produced stint belongs to a team the oracle also resolved — no stint is invented.
            var producedTeams = stints.Select(s => s.TeamId).ToHashSet();
            if (producedTeams.Any(team => !expectedByTeam.ContainsKey(team)))
            {
                return false;
            }

            foreach (var (teamId, expected) in expectedByTeam)
            {
                var teamStints = stints
                    .Where(s => s.TeamId == teamId)
                    .OrderBy(s => s.StartMinute)
                    .ToList();

                // The projection resolves exactly the oracle's effective stints for the team — same
                // count, same keeper per start minute (greatest Event_Id wins, Requirement 4.6).
                if (teamStints.Count != expected.Count)
                {
                    return false;
                }

                for (var i = 0; i < expected.Count; i++)
                {
                    if (teamStints[i].StartMinute != expected[i].StartMinute
                        || teamStints[i].KeeperMembershipId != expected[i].KeeperMembershipId)
                    {
                        return false;
                    }
                }

                // Start minutes are strictly increasing — at most one stint begins at any minute, so at
                // most one keeper is in goal for the team at any minute (Requirement 4.6).
                for (var i = 1; i < teamStints.Count; i++)
                {
                    if (teamStints[i].StartMinute <= teamStints[i - 1].StartMinute)
                    {
                        return false;
                    }
                }

                // Intervals partition time in order: each stint ends where the next begins, and the last
                // ends at the match duration minute (Requirement 4.2).
                for (var i = 0; i < teamStints.Count; i++)
                {
                    var expectedEnd = i + 1 < teamStints.Count
                        ? teamStints[i + 1].StartMinute
                        : durationMinute;

                    if (teamStints[i].EndMinute != expectedEnd)
                    {
                        return false;
                    }
                }
            }

            return true;
        });

    /// <summary>
    /// The independent oracle: per kept team, the effective keeper-stint-started events resolved into an
    /// ordered chain. Retracted stints are excluded; among effective stints sharing a start minute for a
    /// team, only the one with the greatest <c>Event_Id</c> survives (Requirement 4.6); the survivors are
    /// ordered by start minute.
    /// </summary>
    private static IReadOnlyDictionary<Guid, IReadOnlyList<ResolvedStint>> ExpectedStintsByTeam(
        IEnumerable<MatchEvent> events)
    {
        var effectiveStints = EffectiveStints(events);

        return effectiveStints
            .GroupBy(s => s.KeptTeamId)
            .ToDictionary(
                teamGroup => teamGroup.Key,
                teamGroup => (IReadOnlyList<ResolvedStint>)teamGroup
                    .GroupBy(s => s.Minute.Value)
                    .Select(startGroup => startGroup.OrderByDescending(s => s.Id).First())
                    .OrderBy(s => s.Minute.Value)
                    .Select(s => new ResolvedStint(s.Minute.Value, s.KeeperMembershipId))
                    .ToList());
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

    /// <summary>An oracle-resolved effective stint: its start minute and the keeper who won that minute.</summary>
    private readonly record struct ResolvedStint(int StartMinute, Guid KeeperMembershipId);
}
