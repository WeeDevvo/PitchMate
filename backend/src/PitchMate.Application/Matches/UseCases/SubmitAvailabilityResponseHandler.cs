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
/// <para>
/// The committed response is reported as the <see cref="SubmitAvailabilityResult"/> contract rather
/// than the <see cref="AvailabilityResponse"/> persistence entity, so the entity's
/// <c>BaseEntity</c>-declared members no longer cross the wire (Requirement 8.1, 8.3). The projection
/// reads the stored response's own submission instant and marked days, so it reports the same values
/// the operation reports today (Requirement 8.4) and, where this submission replaced a prior one, the
/// replacing submission's values only — the aggregate has already discarded the replaced response
/// (Requirement 8.2).
/// </para>
/// <para>
/// Immediately after the match load and <em>before</em> the membership is resolved, the handler
/// refuses a command whose <c>SquadId</c> — the squad named in the request path — is not the squad
/// the match records, returning the same uniform authorisation failure and storing nothing. Because
/// the check precedes the gate, the path squad is never an input to the gate's decision and the
/// acting membership is always resolved from the match's own squad (Requirement 7.3, 7.4, 7.6).
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
    /// Handles a <see cref="SubmitAvailabilityResponseCommand"/>, returning the stored submission as a
    /// <see cref="SubmitAvailabilityResult"/> on success or a typed <see cref="MatchError"/> — a
    /// uniform authorisation failure for a guest/inactive/non-member or an unfindable match, a state
    /// failure when availability is closed, or a validation failure when a non-candidate day is
    /// referenced.
    /// </summary>
    /// <param name="command">The submission request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result<SubmitAvailabilityResult>> HandleAsync(
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

        // The path's squad must be the match's own squad. The check runs before the membership is
        // resolved, so the path squadId is never an input to the gate's decision and binding a
        // caller-supplied squad id grants no access the match's own squad would not grant. A mismatch
        // is refused with the same uniform authorisation failure and stores nothing, so it discloses
        // neither the match's existence nor which squad it belongs to (Requirement 7.3, 7.4, 7.6).
        if (command.SquadId != match.SquadId)
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
            return Result<SubmitAvailabilityResult>.Fail(gate.Error!);
        }

        // The aggregate enforces the GatheringAvailability state gate and candidate-day validation and
        // produces the response; a failure leaves everything unchanged (Requirement 4.4, 4.6, 4.7).
        Result<AvailabilityResponse> submitted = match.SubmitAvailability(
            acting!.Id, command.MarkedDays ?? [], _clock.GetUtcNow());
        if (!submitted.IsSuccess)
        {
            return Result<SubmitAvailabilityResult>.Fail(submitted.Error!);
        }

        AvailabilityResponse stored = submitted.Value!;

        // Persist the upsert atomically, replacing any prior response so the member retains at most one
        // (Requirement 4.2).
        await _availability.UpsertAsync(stored, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        // Project the committed response onto its wire contract: the same submission instant and the
        // same marked days, in the order the aggregate holds them, with every candidate day unwrapped
        // to the bare UTC instant it carries (Requirements 8.1, 8.4, 9.1, 9.2). Because the aggregate
        // discarded any response this submission replaced, the values projected here are the
        // replacing submission's and none of the replaced one's (Requirement 8.2).
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
