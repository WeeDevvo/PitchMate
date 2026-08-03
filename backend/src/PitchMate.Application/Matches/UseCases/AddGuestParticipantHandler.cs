using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Matches;
using SquadMembership = PitchMate.Domain.Squads.SquadMembership;

namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// Adds a guest to a confirmed match's playing pool as a guest <see cref="MatchParticipant"/>
/// (Requirement 7.1). The handler loads the squad-scoped match, resolves the acting membership from
/// the authenticated user and the match's squad, and gates via
/// <see cref="MatchAuthorization.RequireOrganiser"/>, so only an active registered owner or admin may
/// add a guest; every other actor — a plain member, an inactive membership, a guest, or a non-member —
/// and a match that cannot be found is rejected with the uniform
/// <see cref="MatchErrorCode.Unauthorized"/> failure that discloses neither the squad nor the match,
/// and no participant is added (Requirement 14.1, 14.2).
/// <para>
/// The membership to add is resolved through <see cref="ISquadMembershipRepository.GetByIdAsync"/>
/// and must be an active guest membership of the match's squad: a membership that cannot be found or
/// is not a guest is rejected with a <see cref="MatchErrorCode.ValidationFailed"/> failure identifying
/// it as ineligible, leaving the participant set unchanged (Requirement 7.3, 7.7). The
/// <see cref="Match"/> aggregate is the authority for the remaining invariants:
/// <see cref="Match.AddParticipant"/> rejects the addition unless the match is in
/// <see cref="MatchState.Confirmed"/> (Requirement 2.3, 2.5), rejects a membership that belongs to a
/// different squad or is inactive (Requirement 7.3), and rejects a membership that is already a
/// participant as an <see cref="MatchErrorCode.AlreadyParticipant"/> duplicate while retaining it as
/// exactly one participant (Requirement 7.4). On success the mutated aggregate is committed atomically
/// through <see cref="IUnitOfWork.SaveChangesAsync"/>; any failure adds no participant. This action
/// raises no notification.
/// </para>
/// </summary>
public sealed class AddGuestParticipantHandler
{
    private readonly IMatchRepository _matches;
    private readonly ISquadMembershipRepository _memberships;
    private readonly IUnitOfWork _unitOfWork;

    /// <summary>
    /// Creates the handler with the match repository it loads the squad-scoped match through, the
    /// membership repository it resolves the acting and guest memberships in, and the unit of work it
    /// commits the mutated aggregate through.
    /// </summary>
    public AddGuestParticipantHandler(
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
    /// Handles an <see cref="AddGuestParticipantCommand"/>, returning the created participant's
    /// identity on success or a typed <see cref="MatchError"/> — a uniform authorisation failure for a
    /// non-organiser or an unfindable match, a validation failure for an ineligible membership or a
    /// wrong state, or an already-participant failure for a duplicate.
    /// </summary>
    /// <param name="command">The guest-addition request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result<AddGuestParticipantResult>> HandleAsync(
        AddGuestParticipantCommand command,
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

        // Resolve the acting membership and gate: only an active registered owner or admin may add a
        // guest; every other actor is rejected with the uniform failure that adds nothing
        // (Requirement 14.1, 14.2).
        SquadMembership? acting =
            await _memberships.GetByUserAndSquadAsync(command.ActingUserId, match.SquadId, cancellationToken);

        Result gate = MatchAuthorization.RequireOrganiser(acting);
        if (!gate.IsSuccess)
        {
            return Result<AddGuestParticipantResult>.Fail(gate.Error!);
        }

        // Resolve the membership to add and require it to be a guest; a missing or non-guest membership
        // is ineligible for this guest-add path and the participant set is left unchanged
        // (Requirement 7.1, 7.3, 7.7). The aggregate owns the squad-scope, active, and no-duplicate
        // checks against the loaded match.
        SquadMembership? guest = await _memberships.GetByIdAsync(command.GuestMembershipId, cancellationToken);
        if (guest is null || !guest.IsGuest)
        {
            return Fail(
                MatchErrorCode.ValidationFailed,
                $"Membership {command.GuestMembershipId} is ineligible: it must be an active guest membership of this match's squad.");
        }

        // The aggregate enforces the Confirmed state gate, squad-scope/active eligibility, and the
        // no-duplicate invariant; a failure leaves the participant set unchanged
        // (Requirement 2.3, 7.3, 7.4).
        Result<MatchParticipant> added = match.AddParticipant(guest);
        if (!added.IsSuccess)
        {
            return Result<AddGuestParticipantResult>.Fail(added.Error!);
        }

        // Commit the mutated aggregate atomically; a failed commit adds no participant.
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        return Result<AddGuestParticipantResult>.Ok(new AddGuestParticipantResult(added.Value!.Id));
    }

    private static Result<AddGuestParticipantResult> Unauthorized() =>
        Result<AddGuestParticipantResult>.Fail(new MatchError(
            MatchErrorCode.Unauthorized, "The requested action is not permitted."));

    private static Result<AddGuestParticipantResult> Fail(MatchErrorCode code, string message) =>
        Result<AddGuestParticipantResult>.Fail(new MatchError(code, message));
}
