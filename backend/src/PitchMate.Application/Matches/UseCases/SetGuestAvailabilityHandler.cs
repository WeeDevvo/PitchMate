using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Matches;
using SquadMembership = PitchMate.Domain.Squads.SquadMembership;

namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// Submits or replaces a guest's availability response, marked by an owner or admin on the guest's
/// behalf. Guests have no account and can't respond themselves; the response they get here counts
/// towards a day's available players and seeds the guest as a participant on confirmation, exactly
/// as a registered member's own response does.
/// <para>
/// A match that can't be found, a path squad that isn't the match's own, and an actor who isn't an
/// active owner or admin all get the uniform <see cref="MatchErrorCode.Unauthorized"/> failure, so a
/// rejection discloses neither the squad nor the match. A target that isn't an active guest of the
/// match's squad is a <see cref="MatchErrorCode.ValidationFailed"/> failure. The aggregate then owns
/// the state gate and candidate-day validation through <see cref="Match.SubmitAvailability"/>. Any
/// failure stores nothing; a success is committed atomically.
/// </para>
/// </summary>
public sealed class SetGuestAvailabilityHandler
{
    private readonly IMatchRepository _matches;
    private readonly ISquadMembershipRepository _memberships;
    private readonly IAvailabilityRepository _availability;
    private readonly IUnitOfWork _unitOfWork;
    private readonly TimeProvider _clock;

    /// <summary>
    /// Creates the handler with the repositories it loads the match and memberships through and
    /// persists the response through, the unit of work it commits through, and the clock it stamps
    /// the submission instant with.
    /// </summary>
    public SetGuestAvailabilityHandler(
        IMatchRepository matches,
        ISquadMembershipRepository memberships,
        IAvailabilityRepository availability,
        IUnitOfWork unitOfWork,
        TimeProvider clock)
    {
        ArgumentNullException.ThrowIfNull(matches);
        ArgumentNullException.ThrowIfNull(memberships);
        ArgumentNullException.ThrowIfNull(availability);
        ArgumentNullException.ThrowIfNull(unitOfWork);
        ArgumentNullException.ThrowIfNull(clock);

        _matches = matches;
        _memberships = memberships;
        _availability = availability;
        _unitOfWork = unitOfWork;
        _clock = clock;
    }

    /// <summary>
    /// Handles a <see cref="SetGuestAvailabilityCommand"/>, returning the stored response as a
    /// <see cref="SubmitAvailabilityResult"/> or a typed <see cref="MatchError"/>.
    /// </summary>
    /// <param name="command">The request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result<SubmitAvailabilityResult>> HandleAsync(
        SetGuestAvailabilityCommand command,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        // An unfindable match and a path squad that isn't the match's own get the same uniform
        // failure, so neither discloses the match or its squad.
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
            return Result<SubmitAvailabilityResult>.Fail(gate.Error!);
        }

        SquadMembership? guest = await _memberships.GetByIdAsync(command.GuestMembershipId, cancellationToken);
        if (!GuestAvailabilityTarget.IsEligible(guest, match))
        {
            return Result<SubmitAvailabilityResult>.Fail(GuestAvailabilityTarget.Ineligible(command.GuestMembershipId));
        }

        // The aggregate enforces the GatheringAvailability state gate and candidate-day validation.
        Result<AvailabilityResponse> submitted = match.SubmitAvailability(
            guest!.Id, command.MarkedDays ?? [], _clock.GetUtcNow());
        if (!submitted.IsSuccess)
        {
            return Result<SubmitAvailabilityResult>.Fail(submitted.Error!);
        }

        AvailabilityResponse stored = submitted.Value!;
        await _availability.UpsertAsync(stored, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        return Result<SubmitAvailabilityResult>.Ok(new SubmitAvailabilityResult(
            stored.MatchId,
            stored.SquadMembershipId,
            stored.SubmittedAt,
            [.. stored.MarkedDays.Select(day => day.Instant)]));
    }

    private static Result<SubmitAvailabilityResult> Unauthorized() =>
        Result<SubmitAvailabilityResult>.Fail(new MatchError(
            MatchErrorCode.Unauthorized, "The requested action is not permitted."));
}
