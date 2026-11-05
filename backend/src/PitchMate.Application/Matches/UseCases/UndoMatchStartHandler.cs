using PitchMate.Application.Common.Persistence;
using PitchMate.Application.LiveTracking;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Matches;
using SquadMembership = PitchMate.Domain.Squads.SquadMembership;

namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// Undoes a kickoff made by mistake, returning a match from <see cref="MatchState.InProgress"/> to
/// <see cref="MatchState.TeamsRolled"/> with its teams still locked and its kickoff lineup kept. The
/// handler loads the match, resolves the acting user's membership in its squad, and gates through
/// <see cref="MatchAuthorization.RequireOrganiser"/>, so only an active registered owner or admin may
/// undo; every other actor, and a match that cannot be found, gets the single uniform authorisation
/// failure and nothing changes.
/// <para>
/// It reads the match's live-tracking event log through <see cref="IMatchEventRepository"/> and hands
/// <see cref="Match.UndoStart"/> whether any event exists. The aggregate is the authority for the
/// transition: it refuses a match not in play with <see cref="MatchErrorCode.InvalidState"/>, and one
/// with a recorded result or any live event with <see cref="MatchErrorCode.PlayRecorded"/>. The change
/// is committed atomically through <see cref="IUnitOfWork.SaveChangesAsync"/>. No notification is
/// raised, as starting raises none.
/// </para>
/// </summary>
public sealed class UndoMatchStartHandler
{
    private readonly IMatchRepository _matches;
    private readonly ISquadMembershipRepository _memberships;
    private readonly IMatchEventRepository _events;
    private readonly IUnitOfWork _unitOfWork;

    /// <summary>
    /// Creates the handler with the match repository it loads the match through, the membership
    /// repository it gates the acting membership through, the event repository it checks the match's
    /// live-tracking log through, and the unit of work it commits the undo through.
    /// </summary>
    public UndoMatchStartHandler(
        IMatchRepository matches,
        ISquadMembershipRepository memberships,
        IMatchEventRepository events,
        IUnitOfWork unitOfWork)
    {
        ArgumentNullException.ThrowIfNull(matches);
        ArgumentNullException.ThrowIfNull(memberships);
        ArgumentNullException.ThrowIfNull(events);
        ArgumentNullException.ThrowIfNull(unitOfWork);

        _matches = matches;
        _memberships = memberships;
        _events = events;
        _unitOfWork = unitOfWork;
    }

    /// <summary>
    /// Handles an <see cref="UndoMatchStartCommand"/>, returning the match's identity on success or a
    /// typed <see cref="MatchError"/>: the uniform authorisation failure for a non-organiser or an
    /// unfindable match, a state failure when the match is not in play, or
    /// <see cref="MatchErrorCode.PlayRecorded"/> when something has been recorded for it.
    /// </summary>
    /// <param name="command">The undo request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result<UndoMatchStartResult>> HandleAsync(
        UndoMatchStartCommand command,
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

        // A match that cannot be found gets the same uniform failure, so a rejection never discloses
        // whether it exists.
        Match? match = await _matches.GetByIdAsync(command.MatchId, cancellationToken);
        if (match is null)
        {
            return Unauthorized();
        }

        SquadMembership? acting =
            await _memberships.GetByUserAndSquadAsync(command.ActingUserId, match.SquadId, cancellationToken);

        Result gate = MatchAuthorization.RequireOrganiser(acting);
        if (!gate.IsSuccess)
        {
            return Result<UndoMatchStartResult>.Fail(gate.Error!);
        }

        // The log is append-only, so any event at all (a corrected one included) means play has been
        // recorded and the kickoff stands.
        IReadOnlySet<Guid> eventIds = await _events.GetExistingEventIdsAsync(match.Id, cancellationToken);

        Result undone = match.UndoStart(hasLiveEvents: eventIds.Count > 0);
        if (!undone.IsSuccess)
        {
            return Result<UndoMatchStartResult>.Fail(undone.Error!);
        }

        await _unitOfWork.SaveChangesAsync(cancellationToken);

        return Result<UndoMatchStartResult>.Ok(new UndoMatchStartResult(match.Id));
    }

    private static Result<UndoMatchStartResult> Unauthorized() =>
        Result<UndoMatchStartResult>.Fail(new MatchError(
            MatchErrorCode.Unauthorized, "The requested action is not permitted."));

    private static Result<UndoMatchStartResult> Fail(MatchErrorCode code, string message) =>
        Result<UndoMatchStartResult>.Fail(new MatchError(code, message));
}
