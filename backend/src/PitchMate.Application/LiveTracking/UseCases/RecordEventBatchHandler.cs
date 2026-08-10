using PitchMate.Application.Common;
using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.LiveTracking;
// PitchMate.Domain.Matches and PitchMate.Domain.Squads each define their own Result/Result<T> triad.
// Import only PitchMate.Domain.LiveTracking above so the unqualified Result/Result<T> binds to the
// live-tracking triad this handler returns, and pull in the specific Match/Squad types by alias.
using Match = PitchMate.Domain.Matches.Match;
using MatchState = PitchMate.Domain.Matches.MatchState;
using Squad = PitchMate.Domain.Squads.Squad;
using SquadFeature = PitchMate.Domain.Squads.SquadFeature;
using SquadMembership = PitchMate.Domain.Squads.SquadMembership;

namespace PitchMate.Application.LiveTracking.UseCases;

/// <summary>
/// Records an <c>Event_Batch</c> against a single match, the one recording path for the live-tracking
/// event log (Requirement 1, 2). The handler resolves the requester from the authenticated
/// access-token subject via <see cref="ICurrentUserAccessor"/> — never from the request body — loads
/// the squad-scoped match, resolves the requester's membership in that match's squad, and gates
/// through <see cref="LiveTrackingAuthorization.RequireAdmin"/>. A match that cannot be found and any
/// non-admin actor both yield the single uniform <see cref="LiveTrackingErrorCode.Unauthorized"/>
/// failure, so a rejection discloses neither the squad nor whether the match exists
/// (Requirement 11.1, 11.2, 11.4).
/// <para>
/// Once authorised the handler gates the squad's <see cref="SquadFeature.LiveMatchTracking"/> flag
/// (<see cref="LiveTrackingErrorCode.NotEnabled"/> when off, Requirement 9.1), rejects an empty batch
/// (<see cref="LiveTrackingErrorCode.ValidationFailed"/>, Requirement 2.6), and gates the match state:
/// only <see cref="MatchState.InProgress"/> accepts new events; <see cref="MatchState.GatheringAvailability"/>,
/// <see cref="MatchState.Confirmed"/>, and <see cref="MatchState.TeamsRolled"/> yield
/// <see cref="LiveTrackingErrorCode.MatchNotStarted"/> (Requirement 7.2); and
/// <see cref="MatchState.Completed"/>/<see cref="MatchState.Cancelled"/> seal the log to new events with
/// <see cref="LiveTrackingErrorCode.LogSealed"/> (Requirement 7.3) — except that an already-present
/// <c>Event_Id</c> for a sealed match is classified <c>Duplicate</c> and leaves the log unchanged, so
/// idempotency takes precedence over the sealed rejection (Requirement 7.4).
/// </para>
/// <para>
/// For an in-progress match each submitted event is classified independently (Requirement 2.1): a
/// <c>Duplicate</c> when its <c>Event_Id</c> is already present for the match or repeated earlier in the
/// same batch (Requirement 1.2, 2.2, 2.3); a <c>Rejected</c> carrying the reason when it fails the
/// <c>Event_Id</c> policy, the minute range, or per-event validation against the kickoff lineup,
/// participants, and known events (Requirement 1.4, 1.7, 3.x, 4.x, 5.x); and an <c>Applied</c> otherwise
/// — appended and accounted for when validating and deduping later events in the same batch. The
/// accepted events are appended via <see cref="IMatchEventRepository.AppendAsync"/> and committed
/// atomically through <see cref="IUnitOfWork.SaveChangesAsync"/>, so a save failure persists nothing
/// (Requirement 1.3). Per-event <c>Duplicate</c>/<c>Rejected</c> outcomes are not request failures — they
/// ride in the successful <c>Batch_Result</c>.
/// </para>
/// </summary>
public sealed class RecordEventBatchHandler
{
    private readonly IMatchRepository _matches;
    private readonly ISquadMembershipRepository _memberships;
    private readonly ISquadRepository _squads;
    private readonly IMatchEventRepository _events;
    private readonly IUnitOfWork _unitOfWork;
    private readonly ICurrentUserAccessor _currentUser;

    /// <summary>
    /// Creates the handler with the match repository it loads the squad-scoped match through, the
    /// membership repository it resolves and gates the requesting membership through, the squad
    /// repository it reads the <c>LiveMatchTracking</c> flag from, the event repository it classifies
    /// and appends through, the unit of work it commits through, and the current-user accessor it
    /// resolves the requester's identity from.
    /// </summary>
    public RecordEventBatchHandler(
        IMatchRepository matches,
        ISquadMembershipRepository memberships,
        ISquadRepository squads,
        IMatchEventRepository events,
        IUnitOfWork unitOfWork,
        ICurrentUserAccessor currentUser)
    {
        ArgumentNullException.ThrowIfNull(matches);
        ArgumentNullException.ThrowIfNull(memberships);
        ArgumentNullException.ThrowIfNull(squads);
        ArgumentNullException.ThrowIfNull(events);
        ArgumentNullException.ThrowIfNull(unitOfWork);
        ArgumentNullException.ThrowIfNull(currentUser);

        _matches = matches;
        _memberships = memberships;
        _squads = squads;
        _events = events;
        _unitOfWork = unitOfWork;
        _currentUser = currentUser;
    }

    /// <summary>
    /// Handles a <see cref="RecordEventBatchCommand"/>, returning a <see cref="BatchResult"/> of the
    /// ordered per-event outcomes on success, or a typed <see cref="LiveTrackingError"/> when the
    /// request as a whole cannot proceed (authorisation, feature flag, match state, or an empty batch).
    /// </summary>
    /// <param name="command">The batch-recording request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result<BatchResult>> HandleAsync(
        RecordEventBatchCommand command,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        // Resolve the requester from the token subject only; a missing or malformed subject is the
        // uniform, existence-concealing authorisation failure (Requirement 11.1).
        if (!TryResolveRequester(out Guid requesterUserId))
        {
            return Unauthorized();
        }

        // Load the squad-scoped match. A match that cannot be found is rejected with the same uniform
        // authorisation failure so a rejection never discloses whether the match exists (Requirement 11.4).
        Match? match = await _matches.GetByIdAsync(command.MatchId, cancellationToken);
        if (match is null)
        {
            return Unauthorized();
        }

        // Only an active registered owner or admin of the match's squad may record events; every other
        // actor yields the uniform failure that appends nothing (Requirement 11.1, 11.2).
        SquadMembership? requester =
            await _memberships.GetByUserAndSquadAsync(requesterUserId, match.SquadId, cancellationToken);

        Result gate = LiveTrackingAuthorization.RequireAdmin(requester);
        if (!gate.IsSuccess)
        {
            return Result<BatchResult>.Fail(gate.Error!);
        }

        // Gate the squad's live-tracking feature flag; an unavailable squad or unset flag reads as
        // disabled (Requirement 9.1).
        Squad? squad = await _squads.GetByIdAsync(match.SquadId, cancellationToken);
        if (!(squad?.IsFeatureEnabled(SquadFeature.LiveMatchTracking) ?? false))
        {
            return Fail(LiveTrackingErrorCode.NotEnabled, "Live tracking is not enabled for this squad.");
        }

        IReadOnlyList<EventSubmission> submissions = command.Events ?? [];
        if (submissions.Count == 0)
        {
            return Fail(LiveTrackingErrorCode.ValidationFailed, "A batch must contain at least one event.");
        }

        // Gate the trackable window (Requirement 7).
        switch (match.State)
        {
            case MatchState.InProgress:
                return await ClassifyInProgressAsync(match, submissions, cancellationToken);

            case MatchState.Completed:
            case MatchState.Cancelled:
                return await ClassifySealedAsync(match, submissions, cancellationToken);

            default:
                // GatheringAvailability, Confirmed, TeamsRolled — the match has not started.
                return Fail(
                    LiveTrackingErrorCode.MatchNotStarted,
                    "The match has not started, so no events may be recorded.");
        }
    }

    /// <summary>
    /// Classifies a batch for a sealed (<c>Completed</c>/<c>Cancelled</c>) match. An already-present
    /// <c>Event_Id</c> is a <c>Duplicate</c> that leaves the log unchanged (Requirement 7.4); a batch
    /// carrying any not-yet-present <c>Event_Id</c> is rejected wholesale as sealed, appending nothing
    /// (Requirement 7.3), so idempotency takes precedence over the sealed rejection only when every
    /// submitted event is already present.
    /// </summary>
    private async Task<Result<BatchResult>> ClassifySealedAsync(
        Match match,
        IReadOnlyList<EventSubmission> submissions,
        CancellationToken cancellationToken)
    {
        IReadOnlySet<Guid> existingIds = await _events.GetExistingEventIdsAsync(match.Id, cancellationToken);

        if (submissions.Any(s => !existingIds.Contains(s.EventId)))
        {
            return Fail(
                LiveTrackingErrorCode.LogSealed,
                "The match log is sealed; no new events may be recorded for a completed or cancelled match.");
        }

        var outcomes = submissions.Select(s => RecordOutcome.Duplicate(s.EventId)).ToList();
        return Result<BatchResult>.Ok(BatchResult.Create(outcomes));
    }

    /// <summary>
    /// Classifies each submitted event of an in-progress match independently as <c>Applied</c>,
    /// <c>Duplicate</c>, or <c>Rejected</c>, appending the accepted events atomically. A duplicate is an
    /// <c>Event_Id</c> already present for the match or repeated earlier in the same batch; an accepted
    /// event is accounted for so later events in the same batch dedupe and validate against it
    /// (Requirement 2.1, 2.2, 2.3, 2.4).
    /// </summary>
    private async Task<Result<BatchResult>> ClassifyInProgressAsync(
        Match match,
        IReadOnlyList<EventSubmission> submissions,
        CancellationToken cancellationToken)
    {
        IReadOnlySet<Guid> existingIds = await _events.GetExistingEventIdsAsync(match.Id, cancellationToken);
        IReadOnlyList<MatchEvent> existingEvents = await _events.GetForMatchAsync(match.Id, cancellationToken);

        // The event teams reference the working MatchTeam.Id, so the roster map keys on those ids
        // (Requirement 3.5, 4.4); the participant set is the match's full playing pool (Requirement 3.2).
        Dictionary<Guid, IReadOnlyList<Guid>> rosters =
            match.Teams.ToDictionary(t => t.Id, t => (IReadOnlyList<Guid>)t.Roster);
        var participantIds = match.Participants.Select(p => p.SquadMembershipId).ToHashSet();

        // Known events grow as accepted events are appended, so a later retraction can target an
        // earlier applied event in the same batch (Requirement 5.3).
        var knownEvents = new List<MatchEvent>(existingEvents);
        var presentIds = new HashSet<Guid>(existingIds);
        var seenInBatch = new HashSet<Guid>();
        var toAppend = new List<MatchEvent>();
        var outcomes = new List<RecordOutcome>(submissions.Count);

        foreach (EventSubmission submission in submissions)
        {
            // Duplicate takes precedence over validation and append: an id already present in the log
            // or seen earlier in this batch is ignored (Requirement 1.2, 2.2, 2.3).
            if (presentIds.Contains(submission.EventId) || !seenInBatch.Add(submission.EventId))
            {
                outcomes.Add(RecordOutcome.Duplicate(submission.EventId));
                continue;
            }

            Result<MatchEvent> built = BuildAndValidate(submission, match, rosters, participantIds, knownEvents);
            if (!built.IsSuccess)
            {
                outcomes.Add(RecordOutcome.Rejected(submission.EventId, built.Error!));
                continue;
            }

            MatchEvent accepted = built.Value!;
            toAppend.Add(accepted);
            knownEvents.Add(accepted);
            presentIds.Add(submission.EventId);
            outcomes.Add(RecordOutcome.Applied(submission.EventId));
        }

        // Append the accepted events and commit atomically; a save failure persists nothing, so a
        // partially-applied batch never occurs (Requirement 1.3).
        if (toAppend.Count > 0)
        {
            await _events.AppendAsync(toAppend, cancellationToken);
            await _unitOfWork.SaveChangesAsync(cancellationToken);
        }

        return Result<BatchResult>.Ok(BatchResult.Create(outcomes));
    }

    /// <summary>
    /// Validates and constructs the domain <see cref="MatchEvent"/> for one submission: the
    /// <c>Event_Id</c> policy (Requirement 1.4), the minute range (Requirement 3.6, 4.5), and the
    /// per-event recording rules against the match's kickoff lineup, participants, and known events
    /// (Requirement 1.7, 3.x, 4.x, 5.x). Returns the accepted event on success, or the validation error
    /// on failure — never throwing for an expected failure.
    /// </summary>
    private static Result<MatchEvent> BuildAndValidate(
        EventSubmission submission,
        Match match,
        IReadOnlyDictionary<Guid, IReadOnlyList<Guid>> rosters,
        IReadOnlySet<Guid> participantIds,
        IReadOnlyList<MatchEvent> knownEvents)
    {
        Result idPolicy = EventIdPolicy.Validate(submission.EventId);
        if (!idPolicy.IsSuccess)
        {
            return Result<MatchEvent>.Fail(idPolicy.Error!);
        }

        Result<MatchMinute> minute = MatchMinute.Create(submission.Minute);
        if (!minute.IsSuccess)
        {
            return Result<MatchEvent>.Fail(minute.Error!);
        }

        MatchMinute at = minute.Value;
        MatchEvent? candidate = submission.Kind switch
        {
            EventKind.GoalScored => new GoalScoredEvent(
                submission.EventId, match.Id, match.SquadId, at,
                submission.ScoringTeamId ?? Guid.Empty, submission.ScorerMembershipId, submission.OwnGoal),
            EventKind.KeeperStintStarted => new KeeperStintStartedEvent(
                submission.EventId, match.Id, match.SquadId, at,
                submission.KeeperMembershipId ?? Guid.Empty, submission.KeptTeamId ?? Guid.Empty),
            EventKind.GoalRetracted => new GoalRetractedEvent(
                submission.EventId, match.Id, match.SquadId, at, submission.TargetEventId ?? Guid.Empty),
            EventKind.KeeperStintRetracted => new KeeperStintRetractedEvent(
                submission.EventId, match.Id, match.SquadId, at, submission.TargetEventId ?? Guid.Empty),
            _ => null,
        };

        if (candidate is null)
        {
            return Result<MatchEvent>.Fail(new LiveTrackingError(
                LiveTrackingErrorCode.ValidationFailed, $"Unknown event kind '{submission.Kind}'."));
        }

        Result validation = MatchEventValidation.ValidateForRecording(candidate, rosters, participantIds, knownEvents);
        return validation.IsSuccess
            ? Result<MatchEvent>.Ok(candidate)
            : Result<MatchEvent>.Fail(validation.Error!);
    }

    /// <summary>
    /// Resolves the requester's identity from the authenticated access-token subject, returning
    /// <see langword="false"/> when no subject is present or it is not a non-empty GUID — never
    /// accepting a caller-supplied identity from the request body (Requirement 11.1).
    /// </summary>
    private bool TryResolveRequester(out Guid requesterUserId)
    {
        string? subject = _currentUser.CurrentUserId;
        if (!string.IsNullOrWhiteSpace(subject) && Guid.TryParse(subject, out requesterUserId) && requesterUserId != Guid.Empty)
        {
            return true;
        }

        requesterUserId = Guid.Empty;
        return false;
    }

    private static Result<BatchResult> Unauthorized() =>
        Result<BatchResult>.Fail(new LiveTrackingError(
            LiveTrackingErrorCode.Unauthorized, "The requested action is not permitted."));

    private static Result<BatchResult> Fail(LiveTrackingErrorCode code, string message) =>
        Result<BatchResult>.Fail(new LiveTrackingError(code, message));
}
