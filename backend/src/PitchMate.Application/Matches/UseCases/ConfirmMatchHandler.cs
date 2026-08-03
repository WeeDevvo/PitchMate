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
/// Confirms a match on one of its candidate days once enough players are available, transitioning it
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
/// It reads the squad's <c>Minimum_Player_Threshold</c>, defaulting to
/// <see cref="DefaultMinimumPlayerThreshold"/> (10) when the squad configures none (Requirement 6.3),
/// then computes the confirmed day's available count from the squad's active registered members and
/// their stored availability responses (loaded via <see cref="IAvailabilityRepository"/>) using the
/// pure <see cref="AvailabilityTally"/> computation (Requirement 5.1, 6.1). It hands the day, the
/// available count, the threshold, and the active registered members to <see cref="Match.Confirm"/>,
/// which re-validates the state, the candidate day, and the threshold before setting the confirmed
/// day, transitioning to <see cref="MatchState.Confirmed"/>, and seeding one registered participant
/// per active registered member whose response marks the confirmed day (Requirement 6.1, 6.2, 6.4,
/// 6.5). The change is committed atomically through <see cref="IUnitOfWork.SaveChangesAsync"/>, so a
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
/// </summary>
public sealed class ConfirmMatchHandler
{
    /// <summary>
    /// The minimum player threshold applied when the owning squad configures none, so a candidate day
    /// must have at least this many available active registered members before it can be confirmed
    /// (Requirement 6.3).
    /// </summary>
    public const int DefaultMinimumPlayerThreshold = 10;

    private readonly IMatchRepository _matches;
    private readonly IAvailabilityRepository _availability;
    private readonly ISquadMembershipRepository _memberships;
    private readonly ISquadRepository _squads;
    private readonly IUnitOfWork _unitOfWork;
    private readonly INotificationPublisher _publisher;
    private readonly ILogger<ConfirmMatchHandler> _logger;

    /// <summary>
    /// Creates the handler with the match repository it loads and confirms the match through, the
    /// availability repository it computes the confirmed day's available count from, the membership
    /// repository it resolves and gates the acting membership and lists the active registered members
    /// through, the squad repository it reads the minimum threshold and squad name from, the unit of
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

        // Only an active registered owner or admin of the match's squad may confirm (Requirement 6.7).
        SquadMembership? acting =
            await _memberships.GetByUserAndSquadAsync(command.ActingUserId, match.SquadId, cancellationToken);

        Result gate = MatchAuthorization.RequireOrganiser(acting);
        if (!gate.IsSuccess)
        {
            return Result<ConfirmMatchResult>.Fail(gate.Error!);
        }

        // Read the squad's minimum threshold (default 10 when unset) and, for the notification, its name
        // (Requirement 6.3).
        Squad? squad = await _squads.GetByIdAsync(match.SquadId, cancellationToken);
        int minimumThreshold = ResolveMinimumThreshold(squad);

        // The active registered members of the squad are both the seeding candidates and the scope for
        // the available count: only their responses count towards a candidate day (Requirement 5.1, 6.1).
        IReadOnlyList<SquadMembership> squadMembers =
            await _memberships.ListForSquadAsync(match.SquadId, activeOnly: true, cancellationToken);

        List<RegisteredMember> activeRegisteredMembers = squadMembers
            .Where(m => !m.IsGuest)
            .Select(m => new RegisteredMember(m.Id, m.DisplayName))
            .ToList();

        int availableCount = await ComputeAvailableCountAsync(match, command.Day, activeRegisteredMembers, cancellationToken);

        // Confirm on the aggregate: it re-validates the state, the candidate day, and the threshold,
        // and seeds participants from the members whose stored response marks the confirmed day
        // (Requirement 6.1, 6.2, 6.4, 6.5). On any failure the match is left unchanged.
        Result confirmed = match.Confirm(command.Day, availableCount, minimumThreshold, activeRegisteredMembers);
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
    /// Computes the count of available active registered members on <paramref name="day"/> from the
    /// match's stored availability responses, scoped to <paramref name="activeRegisteredMembers"/> so
    /// a member who has since gone inactive or is a guest is excluded (Requirement 5.1, 5.3, 5.4, 6.1).
    /// Returns 0 when <paramref name="day"/> is not a candidate day, in which case
    /// <see cref="Match.Confirm"/> rejects it as an invalid day (Requirement 6.4).
    /// </summary>
    private async Task<int> ComputeAvailableCountAsync(
        Match match,
        DateTimeOffset day,
        IReadOnlyList<RegisteredMember> activeRegisteredMembers,
        CancellationToken cancellationToken)
    {
        IReadOnlyList<AvailabilityResponse> responses =
            await _availability.ListResponsesAsync(match.Id, cancellationToken);

        var activeRegisteredIds = activeRegisteredMembers.Select(m => m.SquadMembershipId).ToHashSet();
        IEnumerable<AvailabilityResponse> scoped =
            responses.Where(r => activeRegisteredIds.Contains(r.SquadMembershipId));

        AvailabilityTally tally = AvailabilityTally.Compute(match.CandidateDays, scoped);

        var confirmedDay = new CandidateDay(day);
        DayAvailability? entry = tally.Days.FirstOrDefault(d => d.Day.Equals(confirmedDay));
        return entry?.Count ?? 0;
    }

    /// <summary>
    /// Resolves the squad's minimum player threshold, defaulting to
    /// <see cref="DefaultMinimumPlayerThreshold"/> when the squad is unavailable or configures none
    /// (Requirement 6.3).
    /// </summary>
    private static int ResolveMinimumThreshold(Squad? squad) =>
        // The squad aggregate carries no configurable threshold today, so the documented default of 10
        // is the effective value; this seam reads any future squad-configured threshold in one place.
        DefaultMinimumPlayerThreshold;

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
