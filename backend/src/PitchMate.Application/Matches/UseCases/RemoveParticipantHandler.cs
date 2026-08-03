using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Matches;
using SquadMembership = PitchMate.Domain.Squads.SquadMembership;

namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// Removes a registered or guest participant from a confirmed match's playing pool (Requirement 7.2).
/// The handler loads the squad-scoped match, resolves the acting membership from the authenticated
/// user and the match's squad, and gates via <see cref="MatchAuthorization.RequireOrganiser"/>, so
/// only an active registered owner or admin may remove a participant; every other actor — a plain
/// member, an inactive membership, a guest, or a non-member — and a match that cannot be found is
/// rejected with the uniform <see cref="MatchErrorCode.Unauthorized"/> failure that discloses neither
/// the squad nor the match, and no participant is removed (Requirement 14.1, 14.2).
/// <para>
/// Once authorised, the <see cref="Match"/> aggregate is the authority for the remaining invariants:
/// <see cref="Match.RemoveParticipant"/> rejects the removal unless the match is in
/// <see cref="MatchState.Confirmed"/> (Requirement 2.3, 2.5) and rejects a membership that is not
/// currently a participant with a <see cref="MatchErrorCode.NotAParticipant"/> failure, leaving the
/// participant set unchanged (Requirement 7.5). On success the mutated aggregate is committed
/// atomically through <see cref="IUnitOfWork.SaveChangesAsync"/>; any failure removes no participant.
/// This action raises no notification.
/// </para>
/// </summary>
public sealed class RemoveParticipantHandler
{
    private readonly IMatchRepository _matches;
    private readonly ISquadMembershipRepository _memberships;
    private readonly IUnitOfWork _unitOfWork;

    /// <summary>
    /// Creates the handler with the match repository it loads the squad-scoped match through, the
    /// membership repository it resolves the acting membership in, and the unit of work it commits the
    /// mutated aggregate through.
    /// </summary>
    public RemoveParticipantHandler(
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
    /// Handles a <see cref="RemoveParticipantCommand"/>, returning success once the participant is
    /// removed or a typed <see cref="MatchError"/> — a uniform authorisation failure for a
    /// non-organiser or an unfindable match, a state failure when the match is not
    /// <see cref="MatchState.Confirmed"/>, or a not-a-participant failure when the membership is not a
    /// participant.
    /// </summary>
    /// <param name="command">The participant-removal request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result> HandleAsync(
        RemoveParticipantCommand command,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        // Load the squad-scoped match. A match that cannot be found is rejected with the same uniform
        // authorisation failure so a rejection never discloses whether the match exists
        // (Requirement 14.1, 14.2).
        Match? match = await _matches.GetByIdAsync(command.MatchId, cancellationToken);
        if (match is null)
        {
            return Unauthorized();
        }

        // Resolve the acting membership and gate: only an active registered owner or admin may remove a
        // participant; every other actor is rejected with the uniform failure that removes nothing
        // (Requirement 14.1, 14.2).
        SquadMembership? acting =
            await _memberships.GetByUserAndSquadAsync(command.ActingUserId, match.SquadId, cancellationToken);

        Result gate = MatchAuthorization.RequireOrganiser(acting);
        if (!gate.IsSuccess)
        {
            return gate;
        }

        // The aggregate enforces the Confirmed state gate and the not-a-participant check; a failure
        // leaves the participant set unchanged (Requirement 2.3, 7.5).
        Result removed = match.RemoveParticipant(command.SquadMembershipId);
        if (!removed.IsSuccess)
        {
            return removed;
        }

        // Commit the mutated aggregate atomically; a failed commit removes no participant.
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        return Result.Ok();
    }

    private static Result Unauthorized() =>
        Result.Fail(new MatchError(MatchErrorCode.Unauthorized, "The requested action is not permitted."));
}
