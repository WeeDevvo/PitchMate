using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Matches;
using SquadMembership = PitchMate.Domain.Squads.SquadMembership;

namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// Starts a match, transitioning it from <see cref="MatchState.TeamsRolled"/> to
/// <see cref="MatchState.InProgress"/> so play can begin (Requirement 11.1, 2.3). The handler loads
/// the squad-scoped match, resolves the acting user's membership in that match's squad, and gates
/// through <see cref="MatchAuthorization.RequireOrganiser"/>, so only an active registered owner or
/// admin may start; every other actor (a plain member, an inactive membership, a guest, or a
/// non-member) — and a request for a match that cannot be found — is rejected with a single uniform
/// authorisation failure that discloses neither the squad nor whether the match exists and changes
/// nothing (Requirement 14.1, 14.2).
/// <para>
/// Once authorised, the <see cref="Match"/> aggregate is the single authority for the transition:
/// <see cref="Match.Start"/> asserts the match is in <see cref="MatchState.TeamsRolled"/> and, on
/// success, moves it to <see cref="MatchState.InProgress"/> while retaining the immutable kickoff
/// lineup captured at team lock; on failure it names the required and current state and leaves the
/// match unchanged (Requirement 11.1, 2.3). The transition is committed atomically through
/// <see cref="IUnitOfWork.SaveChangesAsync"/>, so a failed commit persists no start. Starting a match
/// raises no notification.
/// </para>
/// </summary>
public sealed class StartMatchHandler
{
    private readonly IMatchRepository _matches;
    private readonly ISquadMembershipRepository _memberships;
    private readonly IUnitOfWork _unitOfWork;

    /// <summary>
    /// Creates the handler with the match repository it loads the squad-scoped match through, the
    /// membership repository it resolves and gates the acting membership through, and the unit of work
    /// it commits the start through.
    /// </summary>
    public StartMatchHandler(
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
    /// Handles a <see cref="StartMatchCommand"/>, returning the started match's identity on success or
    /// a typed <see cref="MatchError"/> — a uniform authorisation failure for a non-organiser or an
    /// unfindable match, or a state failure when the match is not in <see cref="MatchState.TeamsRolled"/>.
    /// </summary>
    /// <param name="command">The start request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result<StartMatchResult>> HandleAsync(
        StartMatchCommand command,
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

        // Resolve the acting membership and gate: only an active registered owner or admin may start;
        // every other actor is rejected with the uniform failure that changes nothing
        // (Requirement 14.1, 14.2).
        SquadMembership? acting =
            await _memberships.GetByUserAndSquadAsync(command.ActingUserId, match.SquadId, cancellationToken);

        Result gate = MatchAuthorization.RequireOrganiser(acting);
        if (!gate.IsSuccess)
        {
            return Result<StartMatchResult>.Fail(gate.Error!);
        }

        // The aggregate enforces the state gate (TeamsRolled) and moves the match into play while
        // retaining the immutable kickoff lineup; a failure names the required and current state and
        // leaves the match unchanged (Requirement 11.1, 2.3).
        Result started = match.Start();
        if (!started.IsSuccess)
        {
            return Result<StartMatchResult>.Fail(started.Error!);
        }

        // Persist the transition atomically; a failed commit persists no start. Starting a match raises
        // no notification.
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        return Result<StartMatchResult>.Ok(new StartMatchResult(match.Id));
    }

    private static Result<StartMatchResult> Unauthorized() =>
        Result<StartMatchResult>.Fail(new MatchError(
            MatchErrorCode.Unauthorized, "The requested action is not permitted."));

    private static Result<StartMatchResult> Fail(MatchErrorCode code, string message) =>
        Result<StartMatchResult>.Fail(new MatchError(code, message));
}
