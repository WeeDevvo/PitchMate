using PitchMate.Application.Common;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Matches.UseCases;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.LiveTracking;
// PitchMate.Domain.Matches, PitchMate.Domain.Squads, and PitchMate.Domain.LiveTracking each define
// their own Result/Result<T> triad. Import only PitchMate.Domain.LiveTracking above so the
// unqualified Result/Result<T> binds to the live-tracking triad this handler returns, and pull in the
// specific match-lifecycle / squad types by alias.
using Match = PitchMate.Domain.Matches.Match;
using MatchErrorCode = PitchMate.Domain.Matches.MatchErrorCode;
using MatchResult = PitchMate.Domain.Matches.MatchResult;
using MatchState = PitchMate.Domain.Matches.MatchState;
using ResultFidelity = PitchMate.Domain.Matches.ResultFidelity;
using SquadMembership = PitchMate.Domain.Squads.SquadMembership;
using TeamScore = PitchMate.Domain.Matches.TeamScore;

namespace PitchMate.Application.LiveTracking.UseCases;

/// <summary>
/// Finalises a live-tracked match's result, turning the running score derived from the append-only
/// event log into the match's <c>Rich</c> <see cref="MatchResult"/> and driving match-lifecycle
/// completion so the single, idempotent rating update is applied by the code that already owns it
/// (Requirement 8). The handler resolves the requester from the authenticated access-token subject via
/// <see cref="ICurrentUserAccessor"/> — never from the request body — loads the squad-scoped match,
/// resolves the requester's membership in that match's squad, and gates through
/// <see cref="LiveTrackingAuthorization.RequireAdmin"/>. A match that cannot be found and any non-admin
/// actor both yield the single uniform <see cref="LiveTrackingErrorCode.Unauthorized"/> failure, so a
/// rejection discloses neither the squad nor whether the match exists (Requirement 11.1, 11.2, 11.4).
/// <para>
/// Finalising is permitted only while the match is <see cref="MatchState.InProgress"/>; any other
/// state is rejected with an error naming <see cref="MatchState.InProgress"/> as the required state and
/// records no result — a <see cref="MatchState.Completed"/> or <see cref="MatchState.Cancelled"/> match
/// yields <see cref="LiveTrackingErrorCode.LogSealed"/> and a pre-play match yields
/// <see cref="LiveTrackingErrorCode.MatchNotStarted"/>, mirroring how
/// <see cref="RecordEventBatchHandler"/> names states (Requirement 8.4).
/// </para>
/// <para>
/// For an in-progress match the handler projects the running score from the match's effective events
/// via <see cref="MatchEventLog.ComputeRunningScore"/>, builds a <c>Rich</c> <see cref="MatchResult"/>
/// carrying one <see cref="TeamScore"/> per working team — 0 for a team with no effective goals
/// (Requirement 8.1, 8.5) — and records it on the aggregate through
/// <see cref="Match.RecordResult(MatchResult, bool)"/>. It then delegates to the match-lifecycle
/// <see cref="CompleteMatchHandler"/>, which owns the single, idempotent rating update over the
/// immutable kickoff lineup, per-participant rating snapshots, and the atomic commit; because both
/// handlers share the request-scoped unit of work, the recorded result and the completion commit
/// together in one transaction (Requirement 8.3). This use case itself adds no rating logic. Because
/// the outcome is derived from the per-team scores identically to a <c>Basic</c> result, the
/// win/loss/draw placement matches a basic result with the same scores (Requirement 8.2).
/// </para>
/// </summary>
public sealed class FinaliseTrackedResultHandler
{
    private readonly IMatchRepository _matches;
    private readonly ISquadMembershipRepository _memberships;
    private readonly IMatchEventRepository _events;
    private readonly CompleteMatchHandler _completeMatch;
    private readonly ICurrentUserAccessor _currentUser;

    /// <summary>
    /// Creates the handler with the match repository it loads the squad-scoped match through, the
    /// membership repository it resolves and gates the requesting membership through, the event
    /// repository it reads the match's log from to project the running score, the match-lifecycle
    /// completion handler it delegates the single rating update and atomic commit to, and the
    /// current-user accessor it resolves the requester's identity from.
    /// </summary>
    public FinaliseTrackedResultHandler(
        IMatchRepository matches,
        ISquadMembershipRepository memberships,
        IMatchEventRepository events,
        CompleteMatchHandler completeMatch,
        ICurrentUserAccessor currentUser)
    {
        ArgumentNullException.ThrowIfNull(matches);
        ArgumentNullException.ThrowIfNull(memberships);
        ArgumentNullException.ThrowIfNull(events);
        ArgumentNullException.ThrowIfNull(completeMatch);
        ArgumentNullException.ThrowIfNull(currentUser);

        _matches = matches;
        _memberships = memberships;
        _events = events;
        _completeMatch = completeMatch;
        _currentUser = currentUser;
    }

    /// <summary>
    /// Handles a <see cref="FinaliseTrackedResultCommand"/>, returning the finalised match's identity
    /// and the recorded per-team final scores on success, or a typed <see cref="LiveTrackingError"/>
    /// when the request cannot proceed (authorisation, or a match state other than
    /// <see cref="MatchState.InProgress"/>).
    /// </summary>
    /// <param name="command">The finalisation request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result<FinaliseTrackedResultResult>> HandleAsync(
        FinaliseTrackedResultCommand command,
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

        // Only an active registered owner or admin of the match's squad may finalise the result; every
        // other actor yields the uniform failure that records nothing (Requirement 11.1, 11.2).
        SquadMembership? requester =
            await _memberships.GetByUserAndSquadAsync(requesterUserId, match.SquadId, cancellationToken);

        Result gate = LiveTrackingAuthorization.RequireAdmin(requester);
        if (!gate.IsSuccess)
        {
            return Result<FinaliseTrackedResultResult>.Fail(gate.Error!);
        }

        // Finalising requires the match to be in progress; any other state records no result and is
        // rejected with an error naming InProgress as the required state (Requirement 8.4).
        switch (match.State)
        {
            case MatchState.InProgress:
                break;

            case MatchState.Completed:
            case MatchState.Cancelled:
                return Fail(
                    LiveTrackingErrorCode.LogSealed,
                    $"The tracked result can only be finalised while the match is {MatchState.InProgress}, but it is {match.State}.");

            default:
                return Fail(
                    LiveTrackingErrorCode.MatchNotStarted,
                    $"The tracked result can only be finalised while the match is {MatchState.InProgress}, but it is {match.State}.");
        }

        // Project the running score from the match's effective events and build a Rich result carrying
        // one final score per working team — 0 for a team with no effective goals (Requirement 8.1, 8.5).
        IReadOnlyList<MatchEvent> log = await _events.GetForMatchAsync(match.Id, cancellationToken);
        RunningScore runningScore = MatchEventLog.ComputeRunningScore(log);

        var teamScores = match.Teams
            .Select(team => new TeamScore(team.Id, runningScore.ForTeam(team.Id)))
            .ToList();

        // Record the Rich result on the aggregate. Live tracking is enabled for a match being tracked,
        // so the rich fidelity is accepted; the aggregate owns the state gate and score validation and
        // stores nothing on failure (Requirement 8.1).
        var richResult = new MatchResult(ResultFidelity.Rich, teamScores);
        PitchMate.Domain.Matches.Result recorded = match.RecordResult(richResult, liveTrackingEnabled: true);
        if (!recorded.IsSuccess)
        {
            return Fail(MapMatchCode(recorded.Error!.Code), recorded.Error!.Message);
        }

        // Delegate to match-lifecycle completion, which owns the single, idempotent rating update over
        // the immutable kickoff lineup, the per-participant snapshots, and the atomic commit. Both
        // handlers share the request-scoped unit of work, so the recorded result and the completion
        // commit together in one transaction — this use case adds no rating logic (Requirement 8.3).
        var completion = await _completeMatch.HandleAsync(
            new CompleteMatchCommand(requesterUserId, match.Id), cancellationToken);
        if (!completion.IsSuccess)
        {
            return Fail(MapMatchCode(completion.Error!.Code), completion.Error!.Message);
        }

        return Result<FinaliseTrackedResultResult>.Ok(new FinaliseTrackedResultResult(
            match.Id,
            completion.Value!.TeamScores,
            completion.Value!.AlreadyCompleted));
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

    /// <summary>
    /// Maps a match-lifecycle failure surfaced by recording the result or driving completion onto the
    /// closest live-tracking error code so the finalise seam reports a single error vocabulary. An
    /// authorisation failure stays <see cref="LiveTrackingErrorCode.Unauthorized"/>; a state failure
    /// maps to <see cref="LiveTrackingErrorCode.LogSealed"/>; every other failure (validation, a
    /// missing result, or a concurrency conflict) maps to <see cref="LiveTrackingErrorCode.ValidationFailed"/>.
    /// In the normal finalise flow — an authorised admin, an in-progress match, and a freshly recorded
    /// result — completion succeeds, so these mappings cover only the defensive edges.
    /// </summary>
    private static LiveTrackingErrorCode MapMatchCode(MatchErrorCode code) => code switch
    {
        MatchErrorCode.Unauthorized => LiveTrackingErrorCode.Unauthorized,
        MatchErrorCode.InvalidState => LiveTrackingErrorCode.LogSealed,
        _ => LiveTrackingErrorCode.ValidationFailed,
    };

    private static Result<FinaliseTrackedResultResult> Unauthorized() =>
        Result<FinaliseTrackedResultResult>.Fail(new LiveTrackingError(
            LiveTrackingErrorCode.Unauthorized, "The requested action is not permitted."));

    private static Result<FinaliseTrackedResultResult> Fail(LiveTrackingErrorCode code, string message) =>
        Result<FinaliseTrackedResultResult>.Fail(new LiveTrackingError(code, message));
}
