namespace PitchMate.Domain.LiveTracking;

/// <summary>
/// Pure, per-event recording validation for a candidate <see cref="MatchEvent"/> against the match it
/// belongs to — its kickoff-lineup teams and rosters, its participant set, and its already-recorded
/// events (for retraction target lookups). The single entry point,
/// <see cref="ValidateForRecording"/>, returns a success when the candidate may be appended, or a
/// <see cref="LiveTrackingError"/> whose message identifies the offending or missing field on failure.
/// <para>
/// Validation is a pure function of its inputs, uses only the .NET base class library, and never
/// throws for an expected validation failure — mirroring the discriminated-result convention of the
/// rest of the live-tracking Domain. It is the recording seam for the following rules:
/// </para>
/// <list type="bullet">
///   <item>required fields per <see cref="EventKind"/> (Requirement 1.7);</item>
///   <item>goal: a valid scoring team (Requirement 3.5), a named scorer that is a participant
///   (Requirement 3.2) and — unless an own goal — on the scoring team's roster (Requirement 3.3), with
///   an absent scorer permitted (Requirement 3.7);</item>
///   <item>stint: a valid kept team (Requirement 4.4) and a keeper on that team's roster
///   (Requirement 4.3);</item>
///   <item>retraction: a target that exists in the same match (Requirement 5.3), is of the matching
///   kind (Requirement 5.4), and is not itself a retraction (Requirement 5.6).</item>
/// </list>
/// <para>
/// The candidate's <see cref="MatchEvent.Minute"/> is a <see cref="MatchMinute"/>, whose factory has
/// already enforced the inclusive [0, 200] range (Requirement 3.6, 4.5) before the event could be
/// constructed, so the minute is structurally valid here and needs no re-checking.
/// </para>
/// </summary>
public static class MatchEventValidation
{
    /// <summary>
    /// Validates <paramref name="candidate"/> for recording against the match's
    /// <paramref name="kickoffTeamRosters"/> (each working <c>MatchTeam.Id</c> mapped to its
    /// kickoff-lineup roster of participant squad-membership identities), the match's
    /// <paramref name="participantMembershipIds"/>, and the <paramref name="existingEvents"/> already
    /// recorded for the same match. Returns <see cref="Result.Ok"/> when the candidate may be appended;
    /// otherwise a failure whose <see cref="LiveTrackingError.Message"/> identifies the offending or
    /// missing field. Never throws for a validation failure.
    /// </summary>
    /// <param name="candidate">The candidate event to validate; its minute is already range-validated by <see cref="MatchMinute"/>.</param>
    /// <param name="kickoffTeamRosters">The match's kickoff teams keyed by working <c>MatchTeam.Id</c>, each value the team's roster of participant membership identities.</param>
    /// <param name="participantMembershipIds">The identities of every participant in the match's playing pool.</param>
    /// <param name="existingEvents">The events already recorded for the same match, used to resolve a retraction's target.</param>
    /// <returns>A successful result when the candidate is valid to record, or a validation failure identifying the offending field.</returns>
    public static Result ValidateForRecording(
        MatchEvent candidate,
        IReadOnlyDictionary<Guid, IReadOnlyList<Guid>> kickoffTeamRosters,
        IReadOnlySet<Guid> participantMembershipIds,
        IReadOnlyList<MatchEvent> existingEvents)
    {
        ArgumentNullException.ThrowIfNull(candidate);
        ArgumentNullException.ThrowIfNull(kickoffTeamRosters);
        ArgumentNullException.ThrowIfNull(participantMembershipIds);
        ArgumentNullException.ThrowIfNull(existingEvents);

        return candidate switch
        {
            GoalScoredEvent goal => ValidateGoal(goal, kickoffTeamRosters, participantMembershipIds),
            KeeperStintStartedEvent stint => ValidateStint(stint, kickoffTeamRosters),
            GoalRetractedEvent retraction =>
                ValidateRetraction(retraction, retraction.TargetEventId, EventKind.GoalScored, existingEvents),
            KeeperStintRetractedEvent retraction =>
                ValidateRetraction(retraction, retraction.TargetEventId, EventKind.KeeperStintStarted, existingEvents),
            _ => Fail($"Unknown event kind '{candidate.Kind}'."),
        };
    }

    /// <summary>
    /// Validates a goal-scored event: a present, valid scoring team (Requirement 1.7, 3.5), and — when
    /// a scorer is named — a scorer that is a participant (Requirement 3.2) and, unless the goal is an
    /// own goal, a member of the scoring team's roster (Requirement 3.3). An absent scorer is permitted
    /// (Requirement 3.7).
    /// </summary>
    private static Result ValidateGoal(
        GoalScoredEvent goal,
        IReadOnlyDictionary<Guid, IReadOnlyList<Guid>> kickoffTeamRosters,
        IReadOnlySet<Guid> participantMembershipIds)
    {
        if (goal.ScoringTeamId == Guid.Empty)
        {
            return Fail("A GoalScored event requires a ScoringTeamId.");
        }

        if (!kickoffTeamRosters.TryGetValue(goal.ScoringTeamId, out var scoringRoster))
        {
            return Fail($"ScoringTeamId '{goal.ScoringTeamId}' is not one of the match's kickoff teams.");
        }

        if (goal.ScorerMembershipId is Guid scorer)
        {
            if (!participantMembershipIds.Contains(scorer))
            {
                return Fail($"Scorer '{scorer}' is not a participant of the match.");
            }

            if (!goal.OwnGoal && !scoringRoster.Contains(scorer))
            {
                return Fail($"Scorer '{scorer}' is not on the scoring team's roster.");
            }
        }

        return Result.Ok();
    }

    /// <summary>
    /// Validates a keeper-stint-started event: present keeper and kept-team fields (Requirement 1.7), a
    /// kept team that is one of the match's teams (Requirement 4.4), and a keeper on that team's roster
    /// (Requirement 4.3).
    /// </summary>
    private static Result ValidateStint(
        KeeperStintStartedEvent stint,
        IReadOnlyDictionary<Guid, IReadOnlyList<Guid>> kickoffTeamRosters)
    {
        if (stint.KeeperMembershipId == Guid.Empty)
        {
            return Fail("A KeeperStintStarted event requires a KeeperMembershipId.");
        }

        if (stint.KeptTeamId == Guid.Empty)
        {
            return Fail("A KeeperStintStarted event requires a KeptTeamId.");
        }

        if (!kickoffTeamRosters.TryGetValue(stint.KeptTeamId, out var keptRoster))
        {
            return Fail($"KeptTeamId '{stint.KeptTeamId}' is not one of the match's kickoff teams.");
        }

        // A keeper on the kept team's roster is necessarily a participant, so this single check covers
        // both the participant and the roster-membership requirements of Requirement 4.3.
        if (!keptRoster.Contains(stint.KeeperMembershipId))
        {
            return Fail($"Keeper '{stint.KeeperMembershipId}' is not on the kept team's roster.");
        }

        return Result.Ok();
    }

    /// <summary>
    /// Validates a retraction event: a present target field (Requirement 1.7), a target that exists in
    /// the same match (Requirement 5.3), that is not itself a retraction (Requirement 5.6), and that is
    /// of the <paramref name="requiredTargetKind"/> the retraction may target (Requirement 5.4). The
    /// not-a-retraction rule is checked before the kind match so that naming a retraction as a target
    /// yields the specific "cannot retract a retraction" failure rather than a generic kind mismatch.
    /// </summary>
    private static Result ValidateRetraction(
        MatchEvent retraction,
        Guid targetEventId,
        EventKind requiredTargetKind,
        IReadOnlyList<MatchEvent> existingEvents)
    {
        if (targetEventId == Guid.Empty)
        {
            return Fail($"A {retraction.Kind} event requires a TargetEventId.");
        }

        var target = existingEvents.FirstOrDefault(e => e.Id == targetEventId);
        if (target is null)
        {
            return Result.Fail(new LiveTrackingError(
                LiveTrackingErrorCode.TargetNotFound,
                $"Target event '{targetEventId}' was not found in this match."));
        }

        if (target.Kind is EventKind.GoalRetracted or EventKind.KeeperStintRetracted)
        {
            return Fail("A Retraction_Event cannot be retracted.");
        }

        if (target.Kind != requiredTargetKind)
        {
            return Fail(
                $"A {retraction.Kind} event must target a {requiredTargetKind} event, " +
                $"but target '{targetEventId}' is a {target.Kind} event.");
        }

        return Result.Ok();
    }

    /// <summary>Builds a <see cref="LiveTrackingErrorCode.ValidationFailed"/> failure with the given diagnostic message.</summary>
    private static Result Fail(string message) =>
        Result.Fail(new LiveTrackingError(LiveTrackingErrorCode.ValidationFailed, message));
}
