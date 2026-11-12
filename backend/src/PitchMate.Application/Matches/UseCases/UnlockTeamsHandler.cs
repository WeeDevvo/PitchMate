using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Matches;
using SquadMembership = PitchMate.Domain.Squads.SquadMembership;

namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// Unlocks a match's locked teams before kickoff, returning it from <see cref="MatchState.TeamsRolled"/>
/// to <see cref="MatchState.Confirmed"/> so an organiser can add or remove players and re-lock. The
/// handler loads the match, resolves the acting user's membership in its squad, and gates through
/// <see cref="MatchAuthorization.RequireOrganiser"/>, so only an active registered owner or admin may
/// unlock; every other actor, and a match that cannot be found, gets the single uniform authorisation
/// failure and nothing changes.
/// <para>
/// <see cref="Match.Unlock"/> is the authority for the transition: it refuses a match that is not
/// locked (one already started, finished or cancelled included) with an
/// <see cref="MatchErrorCode.InvalidState"/> failure. The change is committed atomically through
/// <see cref="IUnitOfWork.SaveChangesAsync"/>. No notification is raised: the squad hears again when
/// the teams are re-locked.
/// </para>
/// </summary>
public sealed class UnlockTeamsHandler
{
    private readonly IMatchRepository _matches;
    private readonly ISquadMembershipRepository _memberships;
    private readonly IUnitOfWork _unitOfWork;

    /// <summary>
    /// Creates the handler with the match repository it loads the match through, the membership
    /// repository it resolves and gates the acting membership through, and the unit of work it commits
    /// the unlock through.
    /// </summary>
    public UnlockTeamsHandler(
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
    /// Handles an <see cref="UnlockTeamsCommand"/>, returning the unlocked match's identity on success
    /// or a typed <see cref="MatchError"/>: the uniform authorisation failure for a non-organiser or an
    /// unfindable match, or a state failure when the teams are not locked.
    /// </summary>
    /// <param name="command">The unlock request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result<UnlockTeamsResult>> HandleAsync(
        UnlockTeamsCommand command,
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
            return Result<UnlockTeamsResult>.Fail(gate.Error!);
        }

        Result unlocked = match.Unlock();
        if (!unlocked.IsSuccess)
        {
            return Result<UnlockTeamsResult>.Fail(unlocked.Error!);
        }

        await _unitOfWork.SaveChangesAsync(cancellationToken);

        return Result<UnlockTeamsResult>.Ok(new UnlockTeamsResult(match.Id));
    }

    private static Result<UnlockTeamsResult> Unauthorized() =>
        Result<UnlockTeamsResult>.Fail(new MatchError(
            MatchErrorCode.Unauthorized, "The requested action is not permitted."));

    private static Result<UnlockTeamsResult> Fail(MatchErrorCode code, string message) =>
        Result<UnlockTeamsResult>.Fail(new MatchError(code, message));
}
