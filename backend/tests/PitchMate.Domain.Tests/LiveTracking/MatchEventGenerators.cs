using FsCheck;
using FsCheck.Fluent;
using PitchMate.Domain.LiveTracking;

namespace PitchMate.Domain.Tests.LiveTracking;

/// <summary>
/// Shared FsCheck generators for <see cref="MatchEvent"/> logs, feeding the property tests for the
/// pure <see cref="MatchEventLog"/> projection (live-tracking design Properties 6–9, 15, 16). A single
/// <see cref="Scenarios"/> generator yields a self-consistent <see cref="MatchEventScenario"/>: a small
/// pool of kickoff teams and their rosters, and an arbitrary log of goal-scored, keeper-stint-started,
/// goal-retracted, and keeper-stint-retracted events over those pools.
/// <para>
/// Every event carries a fresh, valid client GUID v7 <c>Event_Id</c> (<see cref="Guid.CreateVersion7"/>)
/// and a <see cref="MatchMinute"/> in the inclusive [0, 200] range. Team ids, membership ids, and
/// scorers are drawn from deliberately <em>small</em> pools so that goal collisions on a team, repeated
/// scorers, and retractions that genuinely target earlier events all occur meaningfully. Retractions
/// mostly name a real earlier event of the matching kind (so retraction actually takes effect) and
/// occasionally name a stranger id (a no-op target), exercising both paths.
/// </para>
/// <para>
/// The generators are intentionally general — spanning goals (with and without a recorded scorer, and
/// own goals), keeper stints, and both retraction kinds — so the sibling projection property tests can
/// reuse this one source of event logs.
/// </para>
/// </summary>
internal static class MatchEventGenerators
{
    /// <summary>The number of kickoff teams in a generated scenario (a small pool of 2–3).</summary>
    private const int MinTeams = 2;
    private const int MaxTeams = 3;

    /// <summary>The roster size of each kickoff team (a small pool of 1–4 memberships).</summary>
    private const int MinRoster = 1;
    private const int MaxRoster = 4;

    /// <summary>Generates a self-consistent match-event scenario: team pool, rosters, and an event log.</summary>
    public static Gen<MatchEventScenario> Scenarios() =>
        from teamCount in Gen.Choose(MinTeams, MaxTeams)
        from rosterSizes in Gen.ArrayOf(Gen.Choose(MinRoster, MaxRoster), teamCount)
        from primaryCount in Gen.Choose(0, 14)
        from primaries in Gen.ArrayOf(PrimaryDescGen(), primaryCount)
        from retractionCount in Gen.Choose(0, 8)
        from retractions in Gen.ArrayOf(RetractionDescGen(), retractionCount)
        select Build(rosterSizes, primaries, retractions);

    /// <summary>Builds the scenario deterministically from the generated descriptors and fresh identities.</summary>
    private static MatchEventScenario Build(
        int[] rosterSizes,
        PrimaryDesc[] primaries,
        RetractionDesc[] retractions)
    {
        var matchId = Guid.CreateVersion7();
        var squadId = Guid.CreateVersion7();

        var teamIds = rosterSizes.Select(_ => Guid.CreateVersion7()).ToList();
        var rosters = new Dictionary<Guid, IReadOnlyList<Guid>>();
        for (var i = 0; i < teamIds.Count; i++)
        {
            rosters[teamIds[i]] = Enumerable.Range(0, rosterSizes[i])
                .Select(_ => Guid.CreateVersion7())
                .ToList();
        }

        var memberships = rosters.Values.SelectMany(r => r).ToList();

        var primaryEvents = new List<MatchEvent>();
        foreach (var desc in primaries)
        {
            var eventId = Guid.CreateVersion7();
            var minute = MatchMinute.Create(desc.Minute).Value;
            var team = teamIds[desc.TeamPick % teamIds.Count];

            if (desc.KindRoll < 3)
            {
                var scorer = ResolveScorer(desc, team, rosters, memberships);
                var ownGoal = desc.OwnGoalRoll == 0;
                primaryEvents.Add(new GoalScoredEvent(eventId, matchId, squadId, minute, team, scorer, ownGoal));
            }
            else
            {
                var roster = rosters[team];
                var keeper = roster[desc.MemberPick % roster.Count];
                primaryEvents.Add(new KeeperStintStartedEvent(eventId, matchId, squadId, minute, keeper, team));
            }
        }

        var allEvents = new List<MatchEvent>(primaryEvents);
        foreach (var desc in retractions)
        {
            var eventId = Guid.CreateVersion7();
            var minute = MatchMinute.Create(desc.Minute).Value;

            if (desc.TargetExisting && primaryEvents.Count > 0)
            {
                var target = primaryEvents[desc.TargetPick % primaryEvents.Count];
                allEvents.Add(target is GoalScoredEvent
                    ? new GoalRetractedEvent(eventId, matchId, squadId, minute, target.Id)
                    : new KeeperStintRetractedEvent(eventId, matchId, squadId, minute, target.Id));
            }
            else
            {
                // A stranger target id: a no-op retraction, exercising the mismatch/absent-target path.
                var strangerTarget = Guid.CreateVersion7();
                allEvents.Add(desc.KindPick == 0
                    ? new GoalRetractedEvent(eventId, matchId, squadId, minute, strangerTarget)
                    : new KeeperStintRetractedEvent(eventId, matchId, squadId, minute, strangerTarget));
            }
        }

        return new MatchEventScenario(matchId, squadId, teamIds, rosters, memberships, allEvents);
    }

    /// <summary>
    /// Resolves the scorer for a generated goal: none, a scoring-team roster member, any membership in
    /// the pool, or a fresh non-participant stranger — so the generator spans recorded, unrecorded, and
    /// out-of-roster scorers.
    /// </summary>
    private static Guid? ResolveScorer(
        PrimaryDesc desc,
        Guid scoringTeam,
        IReadOnlyDictionary<Guid, IReadOnlyList<Guid>> rosters,
        IReadOnlyList<Guid> memberships) =>
        desc.ScorerKind switch
        {
            0 => null,
            1 => rosters[scoringTeam][desc.MemberPick % rosters[scoringTeam].Count],
            2 => memberships[desc.MemberPick % memberships.Count],
            _ => Guid.CreateVersion7(),
        };

    /// <summary>
    /// Generates a primary (non-retraction) event descriptor: a kind roll biased toward goals, picks
    /// into the team, scorer, and membership pools, an own-goal roll, and a valid minute.
    /// </summary>
    private static Gen<PrimaryDesc> PrimaryDescGen() =>
        from kindRoll in Gen.Choose(0, 4)
        from teamPick in Gen.Choose(0, 999)
        from scorerKind in Gen.Choose(0, 3)
        from memberPick in Gen.Choose(0, 999)
        from ownGoalRoll in Gen.Choose(0, 3)
        from minute in Gen.Choose(MatchMinute.MinValue, MatchMinute.MaxValue)
        select new PrimaryDesc(kindRoll, teamPick, scorerKind, memberPick, ownGoalRoll, minute);

    /// <summary>
    /// Generates a retraction descriptor: whether it targets a real earlier event (the common case) or a
    /// stranger id, which earlier event to target, the stranger kind, and a valid minute.
    /// </summary>
    private static Gen<RetractionDesc> RetractionDescGen() =>
        from targetRoll in Gen.Choose(0, 4)
        from targetPick in Gen.Choose(0, 999)
        from kindPick in Gen.Choose(0, 1)
        from minute in Gen.Choose(MatchMinute.MinValue, MatchMinute.MaxValue)
        select new RetractionDesc(targetRoll < 4, targetPick, kindPick, minute);

    /// <summary>Raw picks describing one generated goal-scored or keeper-stint-started event.</summary>
    private sealed record PrimaryDesc(
        int KindRoll,
        int TeamPick,
        int ScorerKind,
        int MemberPick,
        int OwnGoalRoll,
        int Minute);

    /// <summary>Raw picks describing one generated goal- or keeper-stint-retraction event.</summary>
    private sealed record RetractionDesc(bool TargetExisting, int TargetPick, int KindPick, int Minute);
}

/// <summary>
/// A generated live-tracking scenario: one match's identity and owning squad, the small pool of kickoff
/// teams with their rosters and the flattened membership pool, and the arbitrary append-only log of that
/// match's events (goals, keeper stints, and retractions) over those pools.
/// </summary>
internal sealed record MatchEventScenario(
    Guid MatchId,
    Guid SquadId,
    IReadOnlyList<Guid> TeamIds,
    IReadOnlyDictionary<Guid, IReadOnlyList<Guid>> Rosters,
    IReadOnlyList<Guid> Memberships,
    IReadOnlyList<MatchEvent> Events);
