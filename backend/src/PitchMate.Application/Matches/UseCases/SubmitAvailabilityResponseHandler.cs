using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Matches;
using SquadMembership = PitchMate.Domain.Squads.SquadMembership;

namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// Submits or replaces an active registered member's availability response for a match that is
/// gathering availability (Requirement 4.1, 4.2). The handler resolves the acting membership from the
/// authenticated user and the match's squad and gates via
/// <see cref="MatchAuthorization.RequireActiveRegisteredMember"/>, so only an active registered member
/// may respond; a guest, an inactive membership, or a non-member — and a match that cannot be found —
/// is rejected with the uniform <see cref="MatchErrorCode.Unauthorized"/> failure that discloses
/// neither the squad nor the match, and no response is stored (Requirement 4.5, 7.6).
/// <para>
/// Once authorised, the <see cref="Match"/> aggregate is the single authority for the state gate and
/// candidate-day validation: <see cref="Match.SubmitAvailability"/> rejects a submission while the
/// match is not in <see cref="MatchState.GatheringAvailability"/> (Requirement 4.6) and one that
/// references any non-candidate day, identifying each offending day and leaving the stored response
/// unchanged (Requirement 4.4). On success the produced response — which may mark an empty subset,
/// distinct from having none (Requirement 4.7) — is persisted through
/// <see cref="IAvailabilityRepository.UpsertAsync"/>, replacing any prior response so the member
/// retains at most one, and committed atomically through <see cref="IUnitOfWork.SaveChangesAsync"/>
/// (Requirement 4.2). Any failure — authorisation, state, or validation — stores nothing.
/// </para>
/// </summary>
public sealed class SubmitAvailabilityResponseHandler
{
    private readonly IMatchRepository _matches;
    private readonly ISquadMembershipRepository _memberships;
    private readonly IAvailabilityRepository _availability;
    private readonly IUnitOfWork _unitOfWork;
    private readonly TimeProvider _clock;

    /// <summary>
    /// Creates the handler with the match repository it loads the squad-scoped match through, the
    /// membership repository it resolves the acting membership in, the availability repository it
    /// persists the response through, the unit of work it commits through, and the clock it stamps the
    /// submission instant with.
    /// </summary>
    public SubmitAvailabilityResponseHandler(
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
    /// Handles a <see cref="SubmitAvailabilityResponseCommand"/>, returning the stored response on
    /// success or a typed <see cref="MatchError"/> — a uniform authorisation failure for a
    /// guest/inactive/non-member or an unfindable match, a state failure when availability is closed,
    /// or a validation failure when a non-candidate day is referenced.
    /// </summary>
    /// <param name="command">The submission request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result<AvailabilityResponse>> HandleAsync(
        SubmitAvailabilityResponseCommand command,
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

        // Resolve the acting membership and gate: only an active registered member may respond; a
        // guest, inactive membership, or non-member is rejected with the uniform failure and nothing
        // is stored (Requirement 4.5, 7.6).
        SquadMembership? acting =
            await _memberships.GetByUserAndSquadAsync(command.ActingUserId, match.SquadId, cancellationToken);

        Result gate = MatchAuthorization.RequireActiveRegisteredMember(acting);
        if (!gate.IsSuccess)
        {
            return Result<AvailabilityResponse>.Fail(gate.Error!);
        }

        // The aggregate enforces the GatheringAvailability state gate and candidate-day validation and
        // produces the response; a failure leaves everything unchanged (Requirement 4.4, 4.6, 4.7).
        Result<AvailabilityResponse> submitted = match.SubmitAvailability(
            acting!.Id, command.MarkedDays ?? [], _clock.GetUtcNow());
        if (!submitted.IsSuccess)
        {
            return submitted;
        }

        // Persist the upsert atomically, replacing any prior response so the member retains at most one
        // (Requirement 4.2).
        await _availability.UpsertAsync(submitted.Value!, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        return submitted;
    }

    private static Result<AvailabilityResponse> Unauthorized() =>
        Result<AvailabilityResponse>.Fail(new MatchError(
            MatchErrorCode.Unauthorized, "The requested action is not permitted."));
}
