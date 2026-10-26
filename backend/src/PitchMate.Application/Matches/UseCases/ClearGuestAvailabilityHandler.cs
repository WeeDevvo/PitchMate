using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Matches;
using SquadMembership = PitchMate.Domain.Squads.SquadMembership;

namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// Clears the availability an owner or admin marked for a guest, reverting the guest to having no
/// stored response. It gates exactly as <see cref="SetGuestAvailabilityHandler"/> does: the uniform
/// <see cref="MatchErrorCode.Unauthorized"/> failure for an unfindable match, a mismatched path squad
/// or an actor who isn't an active owner or admin; <see cref="MatchErrorCode.ValidationFailed"/> for a
/// target that isn't an active guest of the match's squad; and the aggregate's state gate through
/// <see cref="Match.ClearAvailability"/>. Clearing a guest with no stored response is a success that
/// persists nothing.
/// </summary>
public sealed class ClearGuestAvailabilityHandler
{
    private readonly IMatchRepository _matches;
    private readonly ISquadMembershipRepository _memberships;
    private readonly IAvailabilityRepository _availability;
    private readonly IUnitOfWork _unitOfWork;

    /// <summary>
    /// Creates the handler with the repositories it loads the match and memberships through and
    /// removes the response through, and the unit of work it commits through.
    /// </summary>
    public ClearGuestAvailabilityHandler(
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
    /// Handles a <see cref="ClearGuestAvailabilityCommand"/>, returning success once the guest's
    /// response is cleared, or a typed <see cref="MatchError"/>.
    /// </summary>
    /// <param name="command">The request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result> HandleAsync(
        ClearGuestAvailabilityCommand command,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        Match? match = await _matches.GetByIdAsync(command.MatchId, cancellationToken);
        if (match is null || command.SquadId != match.SquadId)
        {
            return Unauthorized();
        }

        SquadMembership? acting =
            await _memberships.GetByUserAndSquadAsync(command.ActingUserId, match.SquadId, cancellationToken);
        Result gate = MatchAuthorization.RequireOrganiser(acting);
        if (!gate.IsSuccess)
        {
            return gate;
        }

        SquadMembership? guest = await _memberships.GetByIdAsync(command.GuestMembershipId, cancellationToken);
        if (!GuestAvailabilityTarget.IsEligible(guest, match))
        {
            return Result.Fail(GuestAvailabilityTarget.Ineligible(command.GuestMembershipId));
        }

        Result cleared = match.ClearAvailability(guest!.Id);
        if (!cleared.IsSuccess)
        {
            return cleared;
        }

        AvailabilityResponse? stored =
            await _availability.GetResponseAsync(command.MatchId, guest.Id, cancellationToken);
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
