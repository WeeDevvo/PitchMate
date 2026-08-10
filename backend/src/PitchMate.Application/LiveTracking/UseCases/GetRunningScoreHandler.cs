using PitchMate.Application.Common;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.LiveTracking;
// PitchMate.Domain.Matches, PitchMate.Domain.Squads, and PitchMate.Domain.LiveTracking each define
// their own Result/Result<T> triad. Import only PitchMate.Domain.LiveTracking above so the
// unqualified Result/Result<T> binds to the live-tracking triad this handler returns, and pull in the
// specific match-lifecycle / squad types by alias.
using Match = PitchMate.Domain.Matches.Match;
using SquadMembership = PitchMate.Domain.Squads.SquadMembership;
using TeamScore = PitchMate.Domain.Matches.TeamScore;

namespace PitchMate.Application.LiveTracking.UseCases;

/// <summary>
/// Reads a live-tracked match's current running score, projecting each working team's count of effective
/// <c>GoalScored</c> events from the match's append-only event log at request time (Requirement 6.1,
/// 13.3). The handler resolves the requester from the authenticated access-token subject via
/// <see cref="ICurrentUserAccessor"/> — never from the request body or query — loads the squad-scoped
/// match, resolves the requester's membership in that match's squad, and gates through
/// <see cref="LiveTrackingAuthorization.RequireActiveMember"/>. A match that cannot be found and any
/// non-member (or inactive membership) both yield the single uniform
/// <see cref="LiveTrackingErrorCode.Unauthorized"/> failure, so a rejection discloses neither the squad
/// nor whether the match exists (Requirement 11.3, 11.4).
/// <para>
/// For a visible match the handler loads the match's events and projects the running score via
/// <see cref="MatchEventLog.ComputeRunningScore"/>, returning one <see cref="TeamScore"/> per working
/// team — 0 for a team with no effective goals (Requirement 6.4). The derivation depends only on the set
/// of effective events, so retractions in force at request time are reflected and the answer is
/// independent of recording or sync order (Requirement 6.2, 13.3). This is a pure read: it adds no
/// derivation logic of its own — reusing the Domain projection — mutates nothing, and broadcasts nothing.
/// </para>
/// </summary>
public sealed class GetRunningScoreHandler
{
    private readonly IMatchRepository _matches;
    private readonly ISquadMembershipRepository _memberships;
    private readonly IMatchEventRepository _events;
    private readonly ICurrentUserAccessor _currentUser;

    /// <summary>
    /// Creates the handler with the match repository it loads the squad-scoped match through, the
    /// membership repository it resolves and gates the requesting membership through, the event
    /// repository it reads the match's log from to project the running score, and the current-user
    /// accessor it resolves the requester's identity from.
    /// </summary>
    public GetRunningScoreHandler(
        IMatchRepository matches,
        ISquadMembershipRepository memberships,
        IMatchEventRepository events,
        ICurrentUserAccessor currentUser)
    {
        ArgumentNullException.ThrowIfNull(matches);
        ArgumentNullException.ThrowIfNull(memberships);
        ArgumentNullException.ThrowIfNull(events);
        ArgumentNullException.ThrowIfNull(currentUser);

        _matches = matches;
        _memberships = memberships;
        _events = events;
        _currentUser = currentUser;
    }

    /// <summary>
    /// Handles a <see cref="GetRunningScoreCommand"/>, returning the match's identity and current
    /// per-team running score on success, or a uniform <see cref="LiveTrackingError"/> when the request
    /// cannot proceed (authorisation, or a match that is not visible to the requester).
    /// </summary>
    /// <param name="command">The running-score read request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result<GetRunningScoreResult>> HandleAsync(
        GetRunningScoreCommand command,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        // Resolve the requester from the token subject only; a missing or malformed subject is the
        // uniform, existence-concealing authorisation failure (Requirement 11.3).
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

        // Any active member of the match's squad may read the running score; a non-member or inactive
        // membership yields the uniform failure that conceals the match's existence (Requirement 11.3, 11.4).
        SquadMembership? requester =
            await _memberships.GetByUserAndSquadAsync(requesterUserId, match.SquadId, cancellationToken);

        Result gate = LiveTrackingAuthorization.RequireActiveMember(requester);
        if (!gate.IsSuccess)
        {
            return Result<GetRunningScoreResult>.Fail(gate.Error!);
        }

        // Project the current running score from the match's effective events. The derivation reads the
        // events as an unordered set and reflects retractions in force, so the tally is order-independent
        // and reuses the Domain projection rather than deriving anything here (Requirement 6.1, 6.2, 13.3).
        IReadOnlyList<MatchEvent> log = await _events.GetForMatchAsync(match.Id, cancellationToken);
        RunningScore runningScore = MatchEventLog.ComputeRunningScore(log);

        // Report one entry per working team, 0 for a team with no effective goals (Requirement 6.4).
        var teamScores = match.Teams
            .Select(team => new TeamScore(team.Id, runningScore.ForTeam(team.Id)))
            .ToList();

        return Result<GetRunningScoreResult>.Ok(new GetRunningScoreResult(match.Id, teamScores));
    }

    /// <summary>
    /// Resolves the requester's identity from the authenticated access-token subject, returning
    /// <see langword="false"/> when no subject is present or it is not a non-empty GUID — never
    /// accepting a caller-supplied identity from the request body or query (Requirement 11.3).
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

    private static Result<GetRunningScoreResult> Unauthorized() =>
        Result<GetRunningScoreResult>.Fail(new LiveTrackingError(
            LiveTrackingErrorCode.Unauthorized, "The requested action is not permitted."));
}
