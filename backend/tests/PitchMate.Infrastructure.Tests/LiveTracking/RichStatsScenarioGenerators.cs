using FsCheck;
using PitchMate.Domain.LiveTracking;

namespace PitchMate.Infrastructure.Tests.LiveTracking;

/// <summary>
/// A generated feature-gating scenario for live-tracking design Property 13: one squad's identity, a
/// small shared pool of membership ids, and the flattened append-only log of that squad's
/// <em>completed</em> matches' events (goals, keeper stints, and both retraction kinds) over those
/// pools. The events are exactly what <see cref="Application.LiveTracking.IMatchEventRepository.GetForSquadCompletedMatchesAsync"/>
/// would return, so <c>EventLogRichStatsSource</c> can be driven over them directly.
/// <para>
/// Pools are deliberately small — 1–4 memberships, 0–3 matches, a handful of events each — so scorers
/// and keepers recur across matches (making the summed rich statistics non-trivial) and so empty logs,
/// fully-retracted logs, and own-goal-only logs all occur meaningfully. An empty scenario (0 matches)
/// is generated often, exercising the enabled-but-empty degradation case (Requirement 9.3).
/// </para>
/// </summary>
public sealed record RichStatsScenario(
    Guid SquadId,
    IReadOnlyList<Guid> Memberships,
    IReadOnlyList<MatchEvent> Events);

internal static class RichStatsScenarioGenerators
{
    private const int MinMemberships = 1;
    private const int MaxMemberships = 4;
    private const int MaxMatches = 3;

    /// <summary>Generates a self-consistent squad-level scenario: membership pool and a completed-match event log.</summary>
    public static Gen<RichStatsScenario> Scenarios() =>
        from membershipCount in Gen.Choose(MinMemberships, MaxMemberships)
        from matchCount in Gen.Choose(0, MaxMatches)
        from matches in Gen.ArrayOf(matchCount, MatchDescGen())
        select Build(membershipCount, matches);

    private static Gen<MatchDesc> MatchDescGen() =>
        from goalCount in Gen.Choose(0, 6)
        from goals in Gen.ArrayOf(goalCount, GoalDescGen())
        from stintCount in Gen.Choose(0, 3)
        from stints in Gen.ArrayOf(stintCount, StintDescGen())
        from retractionCount in Gen.Choose(0, 3)
        from retractions in Gen.ArrayOf(retractionCount, RetractionDescGen())
        select new MatchDesc(goals, stints, retractions);

    private static Gen<GoalDesc> GoalDescGen() =>
        from teamPick in Gen.Choose(0, 1)
        from scorerKind in Gen.Choose(0, 2)
        from memberPick in Gen.Choose(0, 999)
        from ownGoalRoll in Gen.Choose(0, 3)
        from minute in Gen.Choose(MatchMinute.MinValue, MatchMinute.MaxValue)
        select new GoalDesc(teamPick, scorerKind, memberPick, ownGoalRoll, minute);

    private static Gen<StintDesc> StintDescGen() =>
        from teamPick in Gen.Choose(0, 1)
        from memberPick in Gen.Choose(0, 999)
        from minute in Gen.Choose(MatchMinute.MinValue, MatchMinute.MaxValue)
        select new StintDesc(teamPick, memberPick, minute);

    private static Gen<RetractionDesc> RetractionDescGen() =>
        from targetRoll in Gen.Choose(0, 4)
        from targetPick in Gen.Choose(0, 999)
        from kindPick in Gen.Choose(0, 1)
        from minute in Gen.Choose(MatchMinute.MinValue, MatchMinute.MaxValue)
        select new RetractionDesc(targetRoll < 4, targetPick, kindPick, minute);

    /// <summary>Builds the scenario deterministically from the generated descriptors and fresh identities.</summary>
    private static RichStatsScenario Build(int membershipCount, MatchDesc[] matches)
    {
        var squadId = Guid.CreateVersion7();
        var memberships = Enumerable.Range(0, membershipCount)
            .Select(_ => Guid.CreateVersion7())
            .ToList();

        var allEvents = new List<MatchEvent>();
        foreach (MatchDesc matchDesc in matches)
        {
            var matchId = Guid.CreateVersion7();
            var teams = new[] { Guid.CreateVersion7(), Guid.CreateVersion7() };

            var primaryEvents = new List<MatchEvent>();

            foreach (GoalDesc goal in matchDesc.Goals)
            {
                var eventId = Guid.CreateVersion7();
                MatchMinute minute = MatchMinute.Create(goal.Minute).Value;
                var team = teams[goal.TeamPick];
                Guid? scorer = goal.ScorerKind == 0 ? null : memberships[goal.MemberPick % memberships.Count];
                var ownGoal = goal.OwnGoalRoll == 0;
                primaryEvents.Add(new GoalScoredEvent(eventId, matchId, squadId, minute, team, scorer, ownGoal));
            }

            foreach (StintDesc stint in matchDesc.Stints)
            {
                var eventId = Guid.CreateVersion7();
                MatchMinute minute = MatchMinute.Create(stint.Minute).Value;
                var team = teams[stint.TeamPick];
                var keeper = memberships[stint.MemberPick % memberships.Count];
                primaryEvents.Add(new KeeperStintStartedEvent(eventId, matchId, squadId, minute, keeper, team));
            }

            var matchEvents = new List<MatchEvent>(primaryEvents);
            foreach (RetractionDesc retraction in matchDesc.Retractions)
            {
                var eventId = Guid.CreateVersion7();
                MatchMinute minute = MatchMinute.Create(retraction.Minute).Value;

                if (retraction.TargetExisting && primaryEvents.Count > 0)
                {
                    MatchEvent target = primaryEvents[retraction.TargetPick % primaryEvents.Count];
                    matchEvents.Add(target is GoalScoredEvent
                        ? new GoalRetractedEvent(eventId, matchId, squadId, minute, target.Id)
                        : new KeeperStintRetractedEvent(eventId, matchId, squadId, minute, target.Id));
                }
                else
                {
                    // A stranger target id: a no-op retraction, exercising the absent-target path.
                    var stranger = Guid.CreateVersion7();
                    matchEvents.Add(retraction.KindPick == 0
                        ? new GoalRetractedEvent(eventId, matchId, squadId, minute, stranger)
                        : new KeeperStintRetractedEvent(eventId, matchId, squadId, minute, stranger));
                }
            }

            allEvents.AddRange(matchEvents);
        }

        return new RichStatsScenario(squadId, memberships, allEvents);
    }

    private sealed record GoalDesc(int TeamPick, int ScorerKind, int MemberPick, int OwnGoalRoll, int Minute);

    private sealed record StintDesc(int TeamPick, int MemberPick, int Minute);

    private sealed record RetractionDesc(bool TargetExisting, int TargetPick, int KindPick, int Minute);

    private sealed record MatchDesc(GoalDesc[] Goals, StintDesc[] Stints, RetractionDesc[] Retractions);
}

/// <summary>FsCheck arbitraries feeding the feature-gating property test (design Property 13).</summary>
public static class FeatureGatingArbitraries
{
    /// <summary>The generated squad-level rich-statistics scenario.</summary>
    public static Arbitrary<RichStatsScenario> RichStatsScenario() =>
        Arb.From(RichStatsScenarioGenerators.Scenarios());
}
