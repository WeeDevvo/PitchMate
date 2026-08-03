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
/// Locks the working teams of a match, producing the team sheet, capturing the immutable kickoff
/// lineup, and notifying the squad that teams were rolled (Requirement 8.5, 8.6, 8.7, 9.3, 10.1,
/// 2.3). The handler loads the squad-scoped match, resolves the acting user's membership in that
/// match's squad, and gates through <see cref="MatchAuthorization.RequireOrganiser"/>, so only an
/// active registered owner or admin may lock; every other actor (a plain member, an inactive
/// membership, a guest, or a non-member) — and a request for a match that cannot be found — is
/// rejected with a single uniform authorisation failure that discloses neither the squad nor whether
/// the match exists and changes nothing (Requirement 14.1, 14.2).
/// <para>
/// Once authorised, the <see cref="Match"/> aggregate is the single authority for the lock:
/// <see cref="Match.Lock"/> validates each team size (5..8, uneven such as 7v6 allowed), that exactly
/// one team is flagged to wear bibs, and that team names are 1..50 characters trimmed and distinct
/// case-insensitively; on success it transitions the match to <see cref="MatchState.TeamsRolled"/>
/// and captures an immutable <c>KickoffLineup</c> from the locked teams (a re-lock while
/// <see cref="MatchState.TeamsRolled"/> replaces it), and on failure it names the unmet rule and
/// leaves the match unchanged (Requirement 8.5, 8.6, 8.7, 9.3, 10.1, 2.3). The transition is
/// committed atomically through <see cref="IUnitOfWork.SaveChangesAsync"/>, so a failed commit
/// persists no lock.
/// </para>
/// <para>
/// Only after the lock has committed successfully does the handler raise exactly one
/// <see cref="NotificationType.TeamsRolled"/> event (a broadcast to the squad's active registered
/// memberships) in a fully isolated best-effort block: any failure result or thrown exception is
/// caught, logged without contact PII, and swallowed, so a publish failure never rolls back the
/// committed lock and never surfaces to the caller (Requirement 3.1, 3.2, 3.3).
/// </para>
/// </summary>
public sealed class LockTeamsHandler
{
    private readonly IMatchRepository _matches;
    private readonly ISquadMembershipRepository _memberships;
    private readonly ISquadRepository _squads;
    private readonly IUnitOfWork _unitOfWork;
    private readonly INotificationPublisher _publisher;
    private readonly ILogger<LockTeamsHandler> _logger;

    /// <summary>
    /// Creates the handler with the match repository it loads the squad-scoped match through, the
    /// membership repository it resolves and gates the acting membership through, the squad repository
    /// it reads the squad name from for notification rendering, the unit of work it commits the lock
    /// through, the notification publisher it raises the <c>TeamsRolled</c> event through after a
    /// committed lock, and the logger it records an isolated publish failure with.
    /// </summary>
    public LockTeamsHandler(
        IMatchRepository matches,
        ISquadMembershipRepository memberships,
        ISquadRepository squads,
        IUnitOfWork unitOfWork,
        INotificationPublisher publisher,
        ILogger<LockTeamsHandler> logger)
    {
        ArgumentNullException.ThrowIfNull(matches);
        ArgumentNullException.ThrowIfNull(memberships);
        ArgumentNullException.ThrowIfNull(squads);
        ArgumentNullException.ThrowIfNull(unitOfWork);
        ArgumentNullException.ThrowIfNull(publisher);
        ArgumentNullException.ThrowIfNull(logger);

        _matches = matches;
        _memberships = memberships;
        _squads = squads;
        _unitOfWork = unitOfWork;
        _publisher = publisher;
        _logger = logger;
    }

    /// <summary>
    /// Handles a <see cref="LockTeamsCommand"/>, returning the locked match's identity on success or a
    /// typed <see cref="MatchError"/> — a uniform authorisation failure for a non-organiser or an
    /// unfindable match, a state failure when the teams are not editable, or a validation failure when
    /// the team composition, bib flag, or names do not meet the lock rules.
    /// </summary>
    /// <param name="command">The lock request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result<LockTeamsResult>> HandleAsync(
        LockTeamsCommand command,
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

        // Load the squad-scoped match. A match that cannot be found is rejected with the same uniform
        // authorisation failure so a rejection never discloses whether the match exists
        // (Requirement 14.1, 14.2).
        Match? match = await _matches.GetByIdAsync(command.MatchId, cancellationToken);
        if (match is null)
        {
            return Unauthorized();
        }

        // Resolve the acting membership and gate: only an active registered owner or admin may lock;
        // every other actor is rejected with the uniform failure that changes nothing
        // (Requirement 14.1, 14.2).
        SquadMembership? acting =
            await _memberships.GetByUserAndSquadAsync(command.ActingUserId, match.SquadId, cancellationToken);

        Result gate = MatchAuthorization.RequireOrganiser(acting);
        if (!gate.IsSuccess)
        {
            return Result<LockTeamsResult>.Fail(gate.Error!);
        }

        // The aggregate enforces the state gate and the composition/bib/name rules and captures the
        // kickoff lineup; a failure names the unmet rule and leaves the match unchanged
        // (Requirement 8.5, 8.6, 8.7, 9.3, 10.1, 2.3).
        Result locked = match.Lock();
        if (!locked.IsSuccess)
        {
            return Result<LockTeamsResult>.Fail(locked.Error!);
        }

        // Persist the lock atomically; a failed commit persists no lock.
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        // Only after the lock has committed successfully, raise exactly one TeamsRolled event. The
        // publish is best-effort and fully isolated (Requirement 3.1, 3.2, 3.3).
        await PublishTeamsRolledAsync(match, cancellationToken);

        return Result<LockTeamsResult>.Ok(new LockTeamsResult(match.Id));
    }

    /// <summary>
    /// Publishes the single <see cref="NotificationType.TeamsRolled"/> broadcast for a freshly
    /// committed lock, owned by the match's squad; the publisher resolves recipients from the squad's
    /// active registered memberships. The whole attempt is best-effort and fully isolated: any failure
    /// result or thrown exception is caught, logged without contact PII — only the notification type,
    /// the squad id, the match id, and a failure reason — and swallowed, so the already-committed lock
    /// is never rolled back and the failure never surfaces to the caller (Requirement 3.1, 3.2, 3.3).
    /// </summary>
    private async Task PublishTeamsRolledAsync(Match match, CancellationToken cancellationToken)
    {
        try
        {
            Squad? squad = await _squads.GetByIdAsync(match.SquadId, cancellationToken);
            var context = new NotificationContext
            {
                SquadName = squad?.Name ?? string.Empty,
                MatchLocation = match.Location,
                MatchScheduledFor = match.ConfirmedDay?.Instant,
            };

            PitchMate.Domain.Notifications.Result published = await _publisher.PublishAsync(
                NotificationType.TeamsRolled,
                match.SquadId,
                directedTargetMembershipIds: [],
                context,
                cancellationToken);

            if (!published.IsSuccess)
            {
                _logger.LogWarning(
                    "Notification publish failed after committed team lock (isolated; lock retained). "
                    + "Type={NotificationType}, SquadId={SquadId}, MatchId={MatchId}, Reason={Reason}",
                    NotificationType.TeamsRolled, match.SquadId, match.Id,
                    published.Error?.Code.ToString() ?? "Unknown");
            }
        }
        catch (Exception ex) when (ex is not OutOfMemoryException and not StackOverflowException)
        {
            // The lock is already committed; isolate every publish failure so it is never rolled back
            // and never surfaces to the caller. Log identifiers and the exception type only — no PII
            // (Requirement 3.3).
            _logger.LogWarning(
                "Notification publish threw after committed team lock (isolated; lock retained). "
                + "Type={NotificationType}, SquadId={SquadId}, MatchId={MatchId}, Reason={Reason}",
                NotificationType.TeamsRolled, match.SquadId, match.Id, ex.GetType().Name);
        }
    }

    private static Result<LockTeamsResult> Unauthorized() =>
        Result<LockTeamsResult>.Fail(new MatchError(
            MatchErrorCode.Unauthorized, "The requested action is not permitted."));

    private static Result<LockTeamsResult> Fail(MatchErrorCode code, string message) =>
        Result<LockTeamsResult>.Fail(new MatchError(code, message));
}
