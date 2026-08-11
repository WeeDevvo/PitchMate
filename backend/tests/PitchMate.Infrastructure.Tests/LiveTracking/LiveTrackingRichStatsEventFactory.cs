using PitchMate.Domain.LiveTracking;

namespace PitchMate.Infrastructure.Tests.LiveTracking;

/// <summary>
/// Builds a plausible append-only <see cref="MatchEvent"/> log for one match from that match's teams
/// and their rosters, for the completed-matches-only model-based test (task 13.4). It emits a mix of
/// goal events (with a recorded scorer, an unrecorded scorer, and own goals), goalkeeper stints, and a
/// scattering of compensating retractions, so the generated log exercises every branch of the pure
/// <see cref="MatchEventLog"/> projection the <c>EventLogRichStatsSource</c> reuses. Every event
/// carries a fresh client-generated GUID v7 <c>Event_Id</c> and the supplied match/squad identities.
/// <para>
/// The factory is a test double for a tracking client's recorded log, not the recording handler: it
/// attaches events directly (bypassing the trackable-window gate) so a log can be planted on matches
/// in <em>any</em> state — including <c>Cancelled</c> and other non-completed states — to prove those
/// matches contribute nothing to the rich statistics (Requirement 10.7, 12.4).
/// </para>
/// </summary>
public static class LiveTrackingRichStatsEventFactory
{
    /// <summary>
    /// Builds the events for a single match. Each team gets one or two keeper stints and zero to four
    /// goals, plus the occasional retraction of a just-emitted goal or stint.
    /// </summary>
    /// <param name="squadId">The owning squad identity carried on every event.</param>
    /// <param name="matchId">The match identity carried on every event.</param>
    /// <param name="teams">Each team's working <c>MatchTeam.Id</c> and its roster of membership ids.</param>
    /// <param name="random">The deterministic randomness driving counts, minutes, and scorer choices.</param>
    /// <returns>The generated append-only event log for the match, in emission order.</returns>
    public static IReadOnlyList<MatchEvent> ForMatch(
        Guid squadId,
        Guid matchId,
        IReadOnlyList<(Guid TeamId, IReadOnlyList<Guid> Roster)> teams,
        Random random)
    {
        ArgumentNullException.ThrowIfNull(teams);
        ArgumentNullException.ThrowIfNull(random);

        var events = new List<MatchEvent>();

        foreach ((Guid teamId, IReadOnlyList<Guid> roster) in teams)
        {
            AppendKeeperStints(events, squadId, matchId, teamId, roster, random);
        }

        foreach ((Guid teamId, IReadOnlyList<Guid> roster) in teams)
        {
            AppendGoals(events, squadId, matchId, teamId, roster, random);
        }

        return events;
    }

    private static void AppendKeeperStints(
        List<MatchEvent> events,
        Guid squadId,
        Guid matchId,
        Guid teamId,
        IReadOnlyList<Guid> roster,
        Random random)
    {
        int stintCount = random.Next(1, 3); // one or two stints per team
        int minute = random.Next(0, 5);

        for (int i = 0; i < stintCount; i++)
        {
            Guid keeper = PickMember(roster, random);
            var stint = new KeeperStintStartedEvent(
                Guid.CreateVersion7(), matchId, squadId, Minute(minute), keeper, teamId);
            events.Add(stint);

            // Occasionally retract the stint just emitted, so retracted stints are exercised.
            if (random.Next(0, 4) == 0)
            {
                events.Add(new KeeperStintRetractedEvent(
                    Guid.CreateVersion7(), matchId, squadId, Minute(minute), stint.Id));
            }

            minute += random.Next(10, 40);
        }
    }

    private static void AppendGoals(
        List<MatchEvent> events,
        Guid squadId,
        Guid matchId,
        Guid teamId,
        IReadOnlyList<Guid> roster,
        Random random)
    {
        int goalCount = random.Next(0, 5); // zero to four goals per team

        for (int i = 0; i < goalCount; i++)
        {
            int minute = random.Next(0, 90);

            int roll = random.Next(0, 10);
            Guid? scorer;
            bool ownGoal;
            if (roll < 2)
            {
                // Unrecorded scorer: counts for the running score, credited to no one (Requirement 3.7).
                scorer = null;
                ownGoal = false;
            }
            else if (roll < 4)
            {
                // Own goal: counts for the team but excluded from the scorer's goals (Requirement 3.4).
                scorer = PickMember(roster, random);
                ownGoal = true;
            }
            else
            {
                scorer = PickMember(roster, random);
                ownGoal = false;
            }

            var goal = new GoalScoredEvent(
                Guid.CreateVersion7(), matchId, squadId, Minute(minute), teamId, scorer, ownGoal);
            events.Add(goal);

            // Occasionally retract the goal just emitted, so retracted goals are exercised.
            if (random.Next(0, 5) == 0)
            {
                events.Add(new GoalRetractedEvent(
                    Guid.CreateVersion7(), matchId, squadId, Minute(minute), goal.Id));
            }
        }
    }

    /// <summary>Picks a roster member, or a fresh synthetic id when the roster is empty.</summary>
    private static Guid PickMember(IReadOnlyList<Guid> roster, Random random) =>
        roster.Count == 0 ? Guid.CreateVersion7() : roster[random.Next(roster.Count)];

    /// <summary>Builds a valid <see cref="MatchMinute"/> from a clamped whole minute in [0, 200].</summary>
    private static MatchMinute Minute(int value) => MatchMinute.Create(Math.Clamp(value, 0, 200)).Value;
}
