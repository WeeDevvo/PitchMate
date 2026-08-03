using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Matches;
using SquadMembership = PitchMate.Domain.Squads.SquadMembership;

namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// Cancels a match that will not go ahead, transitioning it to <see cref="MatchState.Cancelled"/> so
/// the squad is not left waiting on a dead draft (Requirement 15, 2.4). The handler loads the
/// squad-scoped match, resolves the acting user's membership in that match's squad, and gates through
/// <see cref="MatchAuthorization.RequireOrganiser"/>, so only an active registered owner or admin may
/// cancel; every other actor (a plain member, an inactive membership, a guest, or a non-member) — and
/// a request for a match that cannot be found — is rejected with a single uniform authorisation
/// failure that discloses neither the squad nor whether the match exists and changes nothing
/// (Requirement 15.4, 14.1, 14.2, 14.4).
/// <para>
/// Once authorised, the <see cref="Match"/> aggregate is the single authority for the cancellation:
/// <see cref="Match.Cancel"/> permits the transition only from <see cref="MatchState.GatheringAvailability"/>,
/// <see cref="MatchState.Confirmed"/>, or <see cref="MatchState.TeamsRolled"/>, and rejects it from
/// the terminal or in-play states <see cref="MatchState.InProgress"/>, <see cref="MatchState.Completed"/>,
/// and <see cref="MatchState.Cancelled"/> with an <see cref="MatchErrorCode.InvalidState"/> error
/// naming the current state, leaving the match unchanged (Requirement 15.1, 15.3, 2.4). The
/// cancellation applies no rating update and writes no rating snapshot: the aggregate simply flips the
/// state and touches no participant rating (Requirement 15.2). The transition is committed atomically
/// through <see cref="IUnitOfWork.SaveChangesAsync"/>, so a failed commit leaves the match unchanged.
/// </para>
/// <para>
/// This action raises no notification.
/// </para>
/// </summary>
public sealed class CancelMatchHandler
{
    private readonly IMatchRepository _matches;
    private readonly ISquadMembershipRepository _memberships;
    private readonly IUnitOfWork _unitOfWork;

    /// <summary>
    /// Creates the handler with the match repository it loads the squad-scoped match through, the
    /// membership repository it resolves and gates the acting membership through, and the unit of work
    /// it commits the cancellation through.
    /// </summary>
    public CancelMatchHandler(
        IMatchRepository matches,
        ISquadMembershipRepository memberships,
        IUnitOfWork unitOfWork)
    {
        ArgumentNullException.ThrowIfNull(matches);
        ArgumentNullException.ThrowIfNull(memberships);
        ArgumentNullException.ThrowIfNull(unitOfWork);

        _matches = matches;
        _memberships = memberships;
        _unitOfWork = unitOfWork;
    }

    /// <summary>
    /// Handles a <see cref="CancelMatchCommand"/>, returning the cancelled match's identity on success
    /// or a typed <see cref="MatchError"/> — a uniform authorisation failure for a non-organiser or an
    /// unfindable match, or a state failure when the match is <see cref="MatchState.InProgress"/>,
    /// <see cref="MatchState.Completed"/>, or already <see cref="MatchState.Cancelled"/>.
    /// </summary>
    /// <param name="command">The cancellation request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result<CancelMatchResult>> HandleAsync(
        CancelMatchCommand command,
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
        // (Requirement 14.1, 14.2, 14.4).
        Match? match = await _matches.GetByIdAsync(command.MatchId, cancellationToken);
        if (match is null)
        {
            return Unauthorized();
        }

        // Resolve the acting membership and gate: only an active registered owner or admin may cancel;
        // every other actor is rejected with the uniform failure that changes nothing
        // (Requirement 15.4, 14.1, 14.2).
        SquadMembership? acting =
            await _memberships.GetByUserAndSquadAsync(command.ActingUserId, match.SquadId, cancellationToken);

        Result gate = MatchAuthorization.RequireOrganiser(acting);
        if (!gate.IsSuccess)
        {
            return Result<CancelMatchResult>.Fail(gate.Error!);
        }

        // The aggregate enforces the allowed-source-state rules and cancels; a failure names the
        // current state and leaves the match unchanged. Cancellation applies no rating update and
        // writes no snapshot (Requirement 15.1, 15.2, 15.3, 2.4).
        Result cancelled = match.Cancel();
        if (!cancelled.IsSuccess)
        {
            return Result<CancelMatchResult>.Fail(cancelled.Error!);
        }

        // Persist the cancellation atomically; a failed commit leaves the match unchanged.
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        return Result<CancelMatchResult>.Ok(new CancelMatchResult(match.Id));
    }

    private static Result<CancelMatchResult> Unauthorized() =>
        Result<CancelMatchResult>.Fail(new MatchError(
            MatchErrorCode.Unauthorized, "The requested action is not permitted."));

    private static Result<CancelMatchResult> Fail(MatchErrorCode code, string message) =>
        Result<CancelMatchResult>.Fail(new MatchError(code, message));
}
