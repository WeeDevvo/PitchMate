using Microsoft.Extensions.Logging;
using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Notifications;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Matches;
using NotificationType = PitchMate.Domain.Notifications.NotificationType;
using Squad = PitchMate.Domain.Squads.Squad;
using SquadMembership = PitchMate.Domain.Squads.SquadMembership;

namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// Confirms a match on whichever of its candidate days an organiser chooses, transitioning it
/// from <see cref="MatchState.GatheringAvailability"/> to <see cref="MatchState.Confirmed"/> and
/// notifying the squad that the game is on (Requirement 6, 2.3).
/// <para>
/// The handler loads the match, resolves the acting user's membership in the match's squad via
/// <see cref="ISquadMembershipRepository.GetByUserAndSquadAsync"/>, and gates through
/// <see cref="MatchAuthorization.RequireOrganiser"/>, so only an active registered owner or admin may
/// confirm; every other actor (plain member, inactive membership, guest, or non-member) — and a
/// request for a match that does not exist — is rejected with a single uniform authorisation failure
/// that changes nothing and discloses neither the squad nor the match (Requirement 6.7, 14.1, 14.2).
/// </para>
/// <para>
/// Availability is a guide, not a gate: there is no minimum player count. The handler hands the day
/// and the squad's active members, guests included, to <see cref="Match.Confirm"/>, which validates
/// the state and the candidate day before setting the confirmed day, transitioning to
/// <see cref="MatchState.Confirmed"/>, and seeding one participant per active member whose stored
/// response marks the confirmed day, a guest's being one an admin marked for it (Requirement 6.1,
/// 6.4, 6.5). More players join or are added afterwards. The change is committed atomically through <see cref="IUnitOfWork.SaveChangesAsync"/>, so a
/// failed commit leaves the match in <see cref="MatchState.GatheringAvailability"/> with no confirmed
/// day and no participants (Requirement 6.1).
/// </para>
/// <para>
/// Only after a successful commit does the handler raise exactly one
/// <see cref="NotificationType.MatchConfirmed"/> event (a broadcast owned by the match's squad) in a
/// fully isolated best-effort block: any failure result or thrown exception is caught, logged without
/// contact PII, and swallowed, so a publish failure never rolls back the committed confirmation and
/// never surfaces to the caller (Requirement 6.6).
/// </para>
/// <para>
/// Immediately after the match load and <em>before</em> the membership is resolved, the handler
/// refuses a command whose <c>SquadId</c> — the squad named in the request path — is not the squad
/// the match records, returning the same uniform authorisation failure and confirming nothing.
/// Because the check precedes the gate, the path squad is never an input to the gate's decision and
/// the acting membership is always resolved from the match's own squad (Requirement 7.3, 7.4, 7.6).
/// </para>
/// </summary>
public sealed class ConfirmMatchHandler
{
    private readonly IMatchRepository _matches;
    private readonly IAvailabilityRepository _availability;
    private readonly ISquadMembershipRepository _memberships;
    private readonly ISquadRepository _squads;
    private readonly IUnitOfWork _unitOfWork;
    private readonly INotificationPublisher _publisher;
    private readonly ILogger<ConfirmMatchHandler> _logger;

    /// <summary>
    /// Creates the handler with the match repository it loads and confirms the match through, the
    /// availability repository it reads the stored responses from (they are not part of the loaded
    /// match graph), the membership repository it resolves and gates the acting membership and lists the active members
    /// through, the squad repository it reads the squad name from, the unit of
    /// work it commits through, the notification publisher it raises the <c>MatchConfirmed</c> event
    /// through after a committed confirmation, and the logger it records an isolated publish failure
    /// with.
    /// </summary>
    public ConfirmMatchHandler(
        IMatchRepository matches,
        IAvailabilityRepository availability,
        ISquadMembershipRepository memberships,
        ISquadRepository squads,
        IUnitOfWork unitOfWork,
        INotificationPublisher publisher,
        ILogger<ConfirmMatchHandler> logger)
    {
        ArgumentNullException.ThrowIfNull(matches);
        ArgumentNullException.ThrowIfNull(availability);
        ArgumentNullException.ThrowIfNull(memberships);
        ArgumentNullException.ThrowIfNull(squads);
        ArgumentNullException.ThrowIfNull(unitOfWork);
        ArgumentNullException.ThrowIfNull(publisher);
        ArgumentNullException.ThrowIfNull(logger);

        _matches = matches;
        _availability = availability;
        _memberships = memberships;
        _squads = squads;
        _unitOfWork = unitOfWork;
        _publisher = publisher;
        _logger = logger;
    }

    /// <summary>
    /// Handles a <see cref="ConfirmMatchCommand"/>, returning the confirmed match's identity, confirmed
    /// instant, and seeded participant count on success, or a typed <see cref="MatchError"/> when the
    /// actor is not an organiser, the match is absent or in the wrong state, the day is not a candidate
    /// day, or the available count is below the threshold.
    /// </summary>
    /// <param name="command">The confirmation request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result<ConfirmMatchResult>> HandleAsync(
        ConfirmMatchCommand command,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        if (command.ActingUserId == Guid.Empty)
        {
            return Fail(MatchErrorCode.ValidationFailed, "An acting user identifier is required.");
        }

        if (command.MatchId == Guid.Empty)
        {
            return Fail(MatchErrorCode.ValidationFailed, "A match identifier is required.");
        }

        // Load the match first, then gate against its squad. A missing match yields the same uniform
        // authorisation failure as an unauthorised actor, so its (non-)existence is never revealed
        // (Requirement 6.7, 14.1, 14.2).
        Match? match = await _matches.GetByIdAsync(command.MatchId, cancellationToken);
        if (match is null)
        {
            return Result<ConfirmMatchResult>.Fail(MatchAuthorization.RequireOrganiser(null).Error!);
        }

        // The path's squad must be the match's own squad. The check runs before the membership is
        // resolved, so the path squadId is never an input to the gate's decision and binding a
        // caller-supplied squad id grants no access the match's own squad would not grant. A mismatch
        // is refused with the same uniform authorisation failure and confirms nothing, so it discloses
        // neither the match's existence nor which squad it belongs to (Requirement 7.3, 7.4, 7.6).
        if (command.SquadId != match.SquadId)
        {
            return Result<ConfirmMatchResult>.Fail(MatchAuthorization.RequireOrganiser(null).Error!);
        }

        // Only an active registered owner or admin of the match's squad may confirm (Requirement 6.7).
        SquadMembership? acting =
            await _memberships.GetByUserAndSquadAsync(command.ActingUserId, match.SquadId, cancellationToken);

        Result gate = MatchAuthorization.RequireOrganiser(acting);
        if (!gate.IsSuccess)
        {
            return Result<ConfirmMatchResult>.Fail(gate.Error!);
        }

        // The squad's name, for the notification.
        Squad? squad = await _squads.GetByIdAsync(match.SquadId, cancellationToken);

        // The active members of the squad, guests included, are the seeding candidates. A guest's
        // response is one an admin marked for it (Requirement 6.5).
        IReadOnlyList<SquadMembership> squadMembers =
            await _memberships.ListForSquadAsync(match.SquadId, activeOnly: true, cancellationToken);

        List<ConfirmableMember> activeMembers = squadMembers
            .Select(m => new ConfirmableMember(m.Id, m.DisplayName, m.IsGuest))
            .ToList();

        // The stored responses, members' own and guests' marked by an admin. They are written through
        // the availability repository and are not part of the loaded match graph, so they are read here
        // rather than from the aggregate; without them nobody would be seeded.
        IReadOnlyList<AvailabilityResponse> responses =
            await _availability.ListResponsesAsync(match.Id, cancellationToken);

        // Confirm on the aggregate: it validates the state and the candidate day, and seeds participants
        // from the members whose stored response marks the confirmed day (Requirement 6.1, 6.4, 6.5).
        // On any failure the match is left unchanged.
        Result confirmed = match.Confirm(command.Day, activeMembers, responses);
        if (!confirmed.IsSuccess)
        {
            return Result<ConfirmMatchResult>.Fail(confirmed.Error!);
        }

        // Persist the confirmation atomically; a failed commit leaves the match in
        // GatheringAvailability with no confirmed day and no participants (Requirement 6.1).
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        // Only after the confirmation has committed successfully, raise exactly one MatchConfirmed
        // event. The publish is best-effort and fully isolated (Requirement 6.6).
        await PublishMatchConfirmedAsync(match, squad, cancellationToken);

        return Result<ConfirmMatchResult>.Ok(new ConfirmMatchResult(
            match.Id,
            match.ConfirmedDay!.Value.Instant,
            match.Participants.Count));
    }

    /// <summary>
    /// Publishes the single <see cref="NotificationType.MatchConfirmed"/> broadcast for a freshly
    /// committed confirmation, owned by the match's squad; the publisher resolves recipients from the
    /// squad's active registered memberships. The whole attempt is best-effort and fully isolated: any
    /// failure result or thrown exception is caught, logged without contact PII — only the notification
    /// type, the squad id, the match id, and a failure reason — and swallowed, so the already-committed
    /// confirmation is never rolled back and the failure never surfaces to the caller (Requirement 6.6).
    /// </summary>
    private async Task PublishMatchConfirmedAsync(Match match, Squad? squad, CancellationToken cancellationToken)
    {
        try
        {
            var context = new NotificationContext
            {
                SquadName = squad?.Name ?? string.Empty,
                MatchLocation = match.Location,
                MatchScheduledFor = match.ConfirmedDay?.Instant,
            };

            PitchMate.Domain.Notifications.Result published = await _publisher.PublishAsync(
                NotificationType.MatchConfirmed,
                match.SquadId,
                directedTargetMembershipIds: [],
                context,
                cancellationToken);

            if (!published.IsSuccess)
            {
                _logger.LogWarning(
                    "Notification publish failed after committed match confirmation (isolated; confirmation retained). "
                    + "Type={NotificationType}, SquadId={SquadId}, MatchId={MatchId}, Reason={Reason}",
                    NotificationType.MatchConfirmed, match.SquadId, match.Id,
                    published.Error?.Code.ToString() ?? "Unknown");
            }
        }
        catch (Exception ex) when (ex is not OutOfMemoryException and not StackOverflowException)
        {
            // The confirmation is already committed; isolate every publish failure so it is never
            // rolled back and never surfaces to the caller. Log identifiers and the exception type
            // only — no PII (Requirement 6.6).
            _logger.LogWarning(
                "Notification publish threw after committed match confirmation (isolated; confirmation retained). "
                + "Type={NotificationType}, SquadId={SquadId}, MatchId={MatchId}, Reason={Reason}",
                NotificationType.MatchConfirmed, match.SquadId, match.Id, ex.GetType().Name);
        }
    }

    private static Result<ConfirmMatchResult> Fail(MatchErrorCode code, string message) =>
        Result<ConfirmMatchResult>.Fail(new MatchError(code, message));
}
