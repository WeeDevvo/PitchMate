namespace PitchMate.Domain.LiveTracking;

/// <summary>
/// The pure, order-independent projection at the heart of live tracking — the authoritative,
/// test-oracle definition of the running score, keeper stints, and rich statistics derived from a
/// match's append-only <see cref="MatchEvent"/> log. Every method consumes the events as an
/// <em>unordered set</em> and breaks every ordering tie by <c>Event_Id</c>, so the output is
/// independent of the order in which events were recorded or synced (Requirement 6.2, 12.1, 12.2,
/// 12.3).
/// <para>
/// Retraction is not stored on an event; it is derived here from the presence of a matching accepted
/// retraction event, so the log stays strictly append-only and a re-retraction is a harmless
/// duplicate (Requirement 5.1, 5.2). A <c>GoalScored</c> or <c>KeeperStintStarted</c> event named by
/// an accepted retraction of the matching kind is <em>retracted</em> and excluded from every derived
/// value while remaining stored (Requirement 5.2). The set of accepted <c>GoalScored</c> and
/// <c>KeeperStintStarted</c> events that are not retracted is the <em>effective set</em> — the sole
/// basis for the running score, keeper-stint durations, and rich statistics.
/// </para>
/// <para>
/// The projection depends only on the .NET base class library and existing live-tracking Domain
/// types. Per-match derivations (running score, stints, per-membership statistics) take one match's
/// events; the squad-wide <see cref="TopScorer"/> pools events across a set of completed matches,
/// which is sound because retraction targeting keys on globally-unique <c>Event_Id</c>s.
/// </para>
/// </summary>
public static class MatchEventLog
{
    /// <summary>
    /// The identities of the <c>GoalScored</c> and <c>KeeperStintStarted</c> events that are retracted —
    /// each named by at least one accepted retraction event of the matching kind (a
    /// <see cref="GoalRetractedEvent"/> targeting a <see cref="GoalScoredEvent"/>, or a
    /// <see cref="KeeperStintRetractedEvent"/> targeting a <see cref="KeeperStintStartedEvent"/>)
    /// (Requirement 5.1, 5.2). A retraction whose target is absent or of a mismatched kind contributes
    /// nothing here, mirroring the recording validation.
    /// </summary>
    /// <param name="events">The match's accepted events, in any order.</param>
    /// <returns>The set of retracted goal-scored and keeper-stint-started event identities.</returns>
    public static IReadOnlySet<Guid> RetractedEventIds(IEnumerable<MatchEvent> events)
    {
        ArgumentNullException.ThrowIfNull(events);

        var materialised = events as IReadOnlyCollection<MatchEvent> ?? events.ToList();

        var goalScoredIds = new HashSet<Guid>();
        var stintStartedIds = new HashSet<Guid>();
        foreach (var e in materialised)
        {
            switch (e)
            {
                case GoalScoredEvent:
                    goalScoredIds.Add(e.Id);
                    break;
                case KeeperStintStartedEvent:
                    stintStartedIds.Add(e.Id);
                    break;
            }
        }

        var retracted = new HashSet<Guid>();
        foreach (var e in materialised)
        {
            switch (e)
            {
                case GoalRetractedEvent goalRetraction when goalScoredIds.Contains(goalRetraction.TargetEventId):
                    retracted.Add(goalRetraction.TargetEventId);
                    break;
                case KeeperStintRetractedEvent stintRetraction when stintStartedIds.Contains(stintRetraction.TargetEventId):
                    retracted.Add(stintRetraction.TargetEventId);
                    break;
            }
        }

        return retracted;
    }

    /// <summary>
    /// The <em>effective set</em>: the accepted <c>GoalScored</c> and <c>KeeperStintStarted</c> events
    /// that are not retracted (Requirement 5.2). Retraction events themselves are excluded — they are
    /// the mechanism of retraction, not tracked occurrences. The result is ordered by <c>Event_Id</c>
    /// so the projection is deterministic regardless of input order.
    /// </summary>
    /// <param name="events">The match's accepted events, in any order.</param>
    /// <returns>The non-retracted goal-scored and keeper-stint-started events, ordered by <c>Event_Id</c>.</returns>
    public static IReadOnlyList<MatchEvent> EffectiveEvents(IEnumerable<MatchEvent> events)
    {
        ArgumentNullException.ThrowIfNull(events);

        var materialised = events as IReadOnlyCollection<MatchEvent> ?? events.ToList();
        var retracted = RetractedEventIds(materialised);

        return materialised
            .Where(e => e.Kind is EventKind.GoalScored or EventKind.KeeperStintStarted)
            .Where(e => !retracted.Contains(e.Id))
            .OrderBy(e => e.Id)
            .ToList();
    }

    /// <summary>
    /// The <c>Match_Duration_Minute</c>: the greatest <see cref="MatchEvent.Minute"/> among the match's
    /// non-retracted events, or 0 when the match has no non-retracted events. It is the closing bound of
    /// any keeper stint not superseded by a later stint for the same team. Retraction events are never
    /// retracted, so their minutes are eligible; only retracted goal-scored and keeper-stint-started
    /// events are excluded.
    /// </summary>
    /// <param name="events">The match's accepted events, in any order.</param>
    /// <returns>The greatest non-retracted match minute, or 0 when none exists.</returns>
    public static int MatchDurationMinute(IEnumerable<MatchEvent> events)
    {
        ArgumentNullException.ThrowIfNull(events);

        var materialised = events as IReadOnlyCollection<MatchEvent> ?? events.ToList();
        var retracted = RetractedEventIds(materialised);

        var maximum = 0;
        var any = false;
        foreach (var e in materialised)
        {
            if (retracted.Contains(e.Id))
            {
                continue;
            }

            any = true;
            if (e.Minute.Value > maximum)
            {
                maximum = e.Minute.Value;
            }
        }

        return any ? maximum : 0;
    }

    /// <summary>
    /// The running score: for each team, the count of that team's effective <c>GoalScored</c> events
    /// (Requirement 6.1). Computed from the effective set alone, independently of recording order
    /// (Requirement 6.2). A team with no effective goals simply does not appear in the map and reports 0
    /// through <see cref="RunningScore.ForTeam"/> (Requirement 6.4); no count is ever negative
    /// (Requirement 6.5), and a retracted goal contributes nothing, reducing its team's tally by exactly
    /// one (Requirement 6.3).
    /// </summary>
    /// <param name="events">The match's accepted events, in any order.</param>
    /// <returns>The per-team running score derived from the effective goals.</returns>
    public static RunningScore ComputeRunningScore(IEnumerable<MatchEvent> events)
    {
        ArgumentNullException.ThrowIfNull(events);

        var countsByTeam = new Dictionary<Guid, int>();
        foreach (var goal in EffectiveEvents(events).OfType<GoalScoredEvent>())
        {
            countsByTeam[goal.ScoringTeamId] = countsByTeam.GetValueOrDefault(goal.ScoringTeamId, 0) + 1;
        }

        // Counts are derived by incrementing, so they are non-negative by construction; Create succeeds.
        return RunningScore.Create(countsByTeam).Value!;
    }

    /// <summary>
    /// The keeper stints: per team, the effective <c>KeeperStintStarted</c> events resolved into
    /// non-overlapping time intervals (Requirement 4.2, 4.6). Among effective stints for the same team
    /// sharing a start minute, only the one with the greatest <c>Event_Id</c> takes effect from that
    /// minute (Requirement 4.6), so at most one keeper is in goal for a team at any minute. Each
    /// effective stint runs from its start minute to the next effective stint's start minute for the
    /// same team, or to the <see cref="MatchDurationMinute"/> when none follows (Requirement 4.2).
    /// </summary>
    /// <param name="events">The match's accepted events, in any order.</param>
    /// <returns>The resolved keeper stints, ordered by team then start minute.</returns>
    public static IReadOnlyList<KeeperStint> ComputeStints(IEnumerable<MatchEvent> events)
    {
        ArgumentNullException.ThrowIfNull(events);

        var materialised = events as IReadOnlyCollection<MatchEvent> ?? events.ToList();
        var durationMinute = MatchDurationMinute(materialised);

        var effectiveStints = EffectiveEvents(materialised).OfType<KeeperStintStartedEvent>();

        var stints = new List<KeeperStint>();
        foreach (var teamGroup in effectiveStints.GroupBy(s => s.KeptTeamId).OrderBy(g => g.Key))
        {
            // Among stints sharing a start minute for this team, keep only the one with the greatest
            // Event_Id (Requirement 4.6), then order the survivors by start minute.
            var resolved = teamGroup
                .GroupBy(s => s.Minute.Value)
                .Select(startGroup => startGroup.OrderByDescending(s => s.Id).First())
                .OrderBy(s => s.Minute.Value)
                .ToList();

            for (var i = 0; i < resolved.Count; i++)
            {
                var start = resolved[i].Minute.Value;
                var end = i + 1 < resolved.Count ? resolved[i + 1].Minute.Value : durationMinute;
                stints.Add(new KeeperStint(
                    teamGroup.Key,
                    resolved[i].KeeperMembershipId,
                    start,
                    end));
            }
        }

        return stints;
    }

    /// <summary>
    /// The per-match, per-membership rich figures for <paramref name="membershipId"/> (Requirement 10):
    /// <see cref="MatchRichStatistics.Goals"/> is the count of effective, non-own-goal <c>GoalScored</c>
    /// events crediting the membership as scorer (Requirement 3.4, 10.2);
    /// <see cref="MatchRichStatistics.ConcededAsKeeper"/> is the count of effective goals credited to an
    /// opposing team whose minute falls within one of the membership's stints (Requirement 10.3);
    /// <see cref="MatchRichStatistics.KeeperMinutes"/> is the sum of the membership's stint durations
    /// (Requirement 10.5); and <see cref="MatchRichStatistics.KeptAnyStint"/> reports whether the
    /// membership kept one or more stints — the basis for a clean sheet (Requirement 10.4).
    /// <para>
    /// A goal at a minute is conceded by whichever keeper was in goal for the scored-against team at
    /// that minute — the effective stint with the greatest start minute at or before the goal's minute —
    /// so a goal at the closing <see cref="MatchDurationMinute"/> is attributed to the final stint and a
    /// goal before any keeper took over is conceded by none.
    /// </para>
    /// </summary>
    /// <param name="membershipId">The squad-membership identity to compute figures for.</param>
    /// <param name="events">The match's accepted events, in any order.</param>
    /// <returns>The membership's rich figures for this match.</returns>
    public static MatchRichStatistics ForMembership(Guid membershipId, IEnumerable<MatchEvent> events)
    {
        ArgumentNullException.ThrowIfNull(events);

        var materialised = events as IReadOnlyCollection<MatchEvent> ?? events.ToList();
        var effective = EffectiveEvents(materialised);

        var goals = effective
            .OfType<GoalScoredEvent>()
            .Count(g => !g.OwnGoal && g.ScorerMembershipId == membershipId);

        var allStints = ComputeStints(materialised);
        var myStints = allStints.Where(s => s.KeeperMembershipId == membershipId).ToList();

        if (myStints.Count == 0)
        {
            return new MatchRichStatistics(Goals: goals, ConcededAsKeeper: 0, KeeperMinutes: 0, KeptAnyStint: false);
        }

        var keeperMinutes = myStints.Sum(s => s.DurationMinutes);

        var effectiveGoals = effective.OfType<GoalScoredEvent>().ToList();
        var conceded = 0;
        foreach (var stint in myStints)
        {
            var teamStints = allStints
                .Where(s => s.TeamId == stint.TeamId)
                .OrderBy(s => s.StartMinute)
                .ToList();

            foreach (var goal in effectiveGoals)
            {
                // A goal conceded by this keeper's team is one credited to any other (opposing) team.
                if (goal.ScoringTeamId == stint.TeamId)
                {
                    continue;
                }

                // Attribute the goal to the keeper on the pitch for the scored-against team at its
                // minute: the stint with the greatest start minute at or before the goal (Requirement
                // 4.2, 4.6). Guard against double counting across this membership's own stints by only
                // crediting when the active stint is the current one being examined.
                var minute = goal.Minute.Value;
                var active = teamStints
                    .Where(s => s.StartMinute <= minute)
                    .OrderByDescending(s => s.StartMinute)
                    .FirstOrDefault();

                if (active.KeeperMembershipId == membershipId
                    && active.TeamId == stint.TeamId
                    && active.StartMinute == stint.StartMinute
                    && active.StartMinute <= minute)
                {
                    conceded++;
                }
            }
        }

        return new MatchRichStatistics(
            Goals: goals,
            ConcededAsKeeper: conceded,
            KeeperMinutes: keeperMinutes,
            KeptAnyStint: true);
    }

    /// <summary>
    /// The top scorer across a set of completed matches: the membership with the greatest count of
    /// effective, non-own-goal <c>GoalScored</c> events crediting it as scorer, or <see langword="null"/>
    /// when no such goal exists (Requirement 10.6). Pooling events across matches is sound because
    /// retraction targeting keys on globally-unique <c>Event_Id</c>s. A tie on goal count is broken
    /// deterministically by the smallest membership identity so the result is stable regardless of input
    /// order.
    /// </summary>
    /// <param name="events">The accepted events across the squad's completed matches, in any order.</param>
    /// <returns>The top scorer's membership identity, or <see langword="null"/> when none has scored.</returns>
    public static Guid? TopScorer(IEnumerable<MatchEvent> events)
    {
        ArgumentNullException.ThrowIfNull(events);

        var goalsByScorer = new Dictionary<Guid, int>();
        foreach (var goal in EffectiveEvents(events).OfType<GoalScoredEvent>())
        {
            if (goal.OwnGoal || goal.ScorerMembershipId is not Guid scorer)
            {
                continue;
            }

            goalsByScorer[scorer] = goalsByScorer.GetValueOrDefault(scorer, 0) + 1;
        }

        if (goalsByScorer.Count == 0)
        {
            return null;
        }

        var best = goalsByScorer
            .OrderByDescending(pair => pair.Value)
            .ThenBy(pair => pair.Key)
            .First();

        return best.Key;
    }
}
