using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Matches;
using SquadMembership = PitchMate.Domain.Squads.SquadMembership;

namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// Clears an active registered member's own availability response for a match that is gathering
/// availability, reverting the member to having no stored response (Requirement 4.3). The handler
/// resolves the acting membership from the authenticated user and the match's squad and gates via
/// <see cref="MatchAuthorization.RequireActiveRegisteredMember"/>, so only an active registered member
/// may clear; a guest, an inactive membership, or a non-member — and a match that cannot be found — is
/// rejected with the uniform <see cref="MatchErrorCode.Unauthorized"/> failure that discloses neither
/// the squad nor the match, and nothing is changed (Requirement 4.5, 7.6).
/// <para>
/// Once authorised, the <see cref="Match"/> aggregate enforces the state gate:
/// <see cref="Match.ClearAvailability"/> rejects the request while the match is not in
/// <see cref="MatchState.GatheringAvailability"/>, leaving stored responses unchanged
/// (Requirement 4.6). On success the stored response, if any, is removed through
/// <see cref="IAvailabilityRepository.RemoveAsync"/> and committed atomically through
/// <see cref="IUnitOfWork.SaveChangesAsync"/>; when the member has no stored response the clear is a
/// success that persists nothing.
/// </para>
/// </summary>
public sealed class ClearAvailabilityResponseHandler
{
    private readonly IMatchRepository _matches;
    private readonly ISquadMembershipRepository _memberships;
    private readonly IAvailabilityRepository _availability;
    private readonly IUnitOfWork _unitOfWork;

    /// <summary>
    /// Creates the handler with the match repository it loads the squad-scoped match through, the
    /// membership repository it resolves the acting membership in, the availability repository it
    /// clears the stored response through, and the unit of work it commits through.
    /// </summary>
    public ClearAvailabilityResponseHandler(
        IMatchRepository matches,
        ISquadMembershipRepository memberships,
        IAvailabilityRepository availability,
        IUnitOfWork unitOfWork)
    {
        ArgumentNullException.ThrowIfNull(matches);
        ArgumentNullException.ThrowIfNull(memberships);
        ArgumentNullException.ThrowIfNull(availability);
        ArgumentNullException.ThrowIfNull(unitOfWork);

        _matches = matches;
        _memberships = memberships;
        _availability = availability;
        _unitOfWork = unitOfWork;
    }

    /// <summary>
    /// Handles a <see cref="ClearAvailabilityResponseCommand"/>, returning success once the member's
    /// response is cleared (or when there was none) or a typed <see cref="MatchError"/> — a uniform
    /// authorisation failure for a guest/inactive/non-member or an unfindable match, or a state failure
    /// when availability is closed.
    /// </summary>
    /// <param name="command">The clear request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result> HandleAsync(
        ClearAvailabilityResponseCommand command,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        // Load the squad-scoped match. A match that cannot be found is rejected with the same uniform
        // authorisation failure so a rejection never discloses whether the match exists
        // (Requirement 4.5, 14.3).
        Match? match = await _matches.GetByIdAsync(command.MatchId, cancellationToken);
        if (match is null)
        {
            return Unauthorized();
        }

        // Resolve the acting membership and gate: only an active registered member may clear; a guest,
        // inactive membership, or non-member is rejected with the uniform failure and nothing is
        // changed (Requirement 4.5, 7.6).
        SquadMembership? acting =
            await _memberships.GetByUserAndSquadAsync(command.ActingUserId, match.SquadId, cancellationToken);

        Result gate = MatchAuthorization.RequireActiveRegisteredMember(acting);
        if (!gate.IsSuccess)
        {
            return gate;
        }

        // The aggregate enforces the GatheringAvailability state gate; a state failure leaves stored
        // responses unchanged (Requirement 4.6).
        Result cleared = match.ClearAvailability(acting!.Id);
        if (!cleared.IsSuccess)
        {
            return cleared;
        }

        // Remove the stored response, if any; a member with no stored response clears to a success that
        // persists nothing (Requirement 4.3).
        AvailabilityResponse? stored =
            await _availability.GetResponseAsync(command.MatchId, acting.Id, cancellationToken);
        if (stored is not null)
        {
            await _availability.RemoveAsync(stored, cancellationToken);
            await _unitOfWork.SaveChangesAsync(cancellationToken);
        }

        return Result.Ok();
    }

    private static Result Unauthorized() =>
        Result.Fail(new MatchError(MatchErrorCode.Unauthorized, "The requested action is not permitted."));
}
