using PitchMate.Application.Common;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Common;
using PitchMate.Domain.LiveTracking;
// PitchMate.Domain.Matches, PitchMate.Domain.Squads, and PitchMate.Domain.LiveTracking each define
// their own Result/Result<T> triad. Import only PitchMate.Domain.LiveTracking above so the
// unqualified Result/Result<T> binds to the live-tracking triad this handler returns, and pull in the
// specific match-lifecycle / squad types by alias.
using Match = PitchMate.Domain.Matches.Match;
using SquadMembership = PitchMate.Domain.Squads.SquadMembership;

namespace PitchMate.Application.LiveTracking.UseCases;

/// <summary>
/// Returns a live-tracked match's event log to an active member of its squad: every accepted event,
/// retractions included, ordered by <c>Event_Id</c> (GUID v7, so in the order the events were minted).
/// It is gated exactly as the running score is: the requester comes only from the authenticated
/// access-token subject, and a missing or malformed subject, a match that cannot be found, a squad in
/// its deletion grace period, and a requester who is not an active member all yield the one uniform
/// <see cref="LiveTrackingErrorCode.Unauthorized"/> failure, so a rejection discloses nothing.
/// <para>
/// This is a pure read: it mutates and broadcasts nothing, and it reports the log as stored, leaving
/// any derivation (the running score, keeper stints, rich statistics) to the Domain projection.
/// </para>
/// </summary>
public sealed class GetMatchEventsHandler
{
    private readonly IMatchRepository _matches;
    private readonly ISquadMembershipRepository _memberships;
    private readonly IMatchEventRepository _events;
    private readonly ICurrentUserAccessor _currentUser;

    /// <summary>
    /// Creates the handler with the match repository it loads the squad-scoped match through, the
    /// membership repository it resolves and gates the requesting membership through, the event
    /// repository it reads the match's log from, and the current-user accessor it resolves the
    /// requester's identity from.
    /// </summary>
    public GetMatchEventsHandler(
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
    /// Handles a <see cref="GetMatchEventsCommand"/>, returning the match's identity and its ordered
    /// event log on success, or the uniform <see cref="LiveTrackingErrorCode.Unauthorized"/> failure.
    /// </summary>
    /// <param name="command">The event-log read request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result<GetMatchEventsResult>> HandleAsync(
        GetMatchEventsCommand command,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        if (!TryResolveRequester(out Guid requesterUserId))
        {
            return Unauthorized();
        }

        Match? match = await _matches.GetByIdAsync(command.MatchId, cancellationToken);
        if (match is null)
        {
            return Unauthorized();
        }

        SquadMembership? requester =
            await _memberships.GetByUserAndSquadAsync(requesterUserId, match.SquadId, cancellationToken);

        Result gate = LiveTrackingAuthorization.RequireActiveMember(requester);
        if (!gate.IsSuccess)
        {
            return Result<GetMatchEventsResult>.Fail(gate.Error!);
        }

        // A squad in its deletion grace period is not visible: soft-deleting the squad leaves its
        // memberships active, so it is refused here, uniformly with the other causes.
        if (await _memberships.IsSquadPendingDeletionAsync(match.SquadId, cancellationToken))
        {
            return Unauthorized();
        }

        IReadOnlyList<MatchEvent> log = await _events.GetForMatchAsync(match.Id, cancellationToken);
        List<MatchEvent> ordered = [.. log.OrderBy(static matchEvent => matchEvent.Id, UuidV7Comparer.Instance)];

        return Result<GetMatchEventsResult>.Ok(new GetMatchEventsResult(match.Id, ordered));
    }

    /// <summary>
    /// Resolves the requester's identity from the authenticated access-token subject, returning
    /// <see langword="false"/> when no subject is present or it is not a non-empty GUID.
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

    private static Result<GetMatchEventsResult> Unauthorized() =>
        Result<GetMatchEventsResult>.Fail(new LiveTrackingError(
            LiveTrackingErrorCode.Unauthorized, "The requested action is not permitted."));
}
