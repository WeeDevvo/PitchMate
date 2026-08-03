using Microsoft.Extensions.Logging;
using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Notifications;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Matches;
using NotificationType = PitchMate.Domain.Notifications.NotificationType;
using Squad = PitchMate.Domain.Squads.Squad;
using SquadMembership = PitchMate.Domain.Squads.SquadMembership;

namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// Creates a match draft for a squad and notifies the squad to respond (Requirement 1, 2.2, 3).
/// The handler resolves the acting user's membership in the target squad via
/// <see cref="ISquadMembershipRepository.GetByUserAndSquadAsync"/> and gates through
/// <see cref="MatchAuthorization.RequireOrganiser"/>, so only an active registered owner or admin may
/// draft a match; every other actor (plain member, inactive membership, guest, or non-member) is
/// rejected with a single uniform authorisation failure that creates no match and discloses neither
/// the squad nor its membership (Requirement 1.2, 14.1, 14.2).
/// <para>
/// It then builds the draft on the <see cref="Match"/> aggregate through
/// <see cref="Match.CreateDraft"/>, which validates the location (trimmed 1..200), the candidate-day
/// count (1..14), their distinctness, and their strictly-future dating against the clock, creating the
/// match in <see cref="MatchState.GatheringAvailability"/> on success (Requirement 1.1, 1.3, 1.4, 1.5,
/// 1.6, 2.2). A non-empty client-supplied id is retained for idempotent creation (Requirement 13.1).
/// The match is staged and committed atomically through <see cref="IUnitOfWork.SaveChangesAsync"/>, so
/// a failed commit persists no match (Requirement 1.1).
/// </para>
/// <para>
/// Only after the creation has committed successfully does the handler raise exactly one
/// <see cref="NotificationType.MatchDrafted"/> event (a broadcast to the squad's active registered
/// memberships) in a fully isolated best-effort block: any failure result or thrown exception is
/// caught, logged without contact PII, and swallowed, so a publish failure never rolls back the
/// committed match and never surfaces to the caller (Requirement 3.1, 3.2, 3.3).
/// </para>
/// </summary>
public sealed class CreateMatchDraftHandler
{
    private readonly IMatchRepository _matches;
    private readonly ISquadMembershipRepository _memberships;
    private readonly ISquadRepository _squads;
    private readonly IUnitOfWork _unitOfWork;
    private readonly TimeProvider _clock;
    private readonly INotificationPublisher _publisher;
    private readonly ILogger<CreateMatchDraftHandler> _logger;

    /// <summary>
    /// Creates the handler with the match repository it stages the draft into, the membership
    /// repository it resolves and gates the acting membership through, the squad repository it reads
    /// the squad name from for notification rendering, the unit of work it commits through, the clock
    /// it validates candidate-day future-dating against, the notification publisher it raises the
    /// <c>MatchDrafted</c> event through after a committed creation, and the logger it records an
    /// isolated publish failure with.
    /// </summary>
    public CreateMatchDraftHandler(
        IMatchRepository matches,
        ISquadMembershipRepository memberships,
        ISquadRepository squads,
        IUnitOfWork unitOfWork,
        TimeProvider clock,
        INotificationPublisher publisher,
        ILogger<CreateMatchDraftHandler> logger)
    {
        ArgumentNullException.ThrowIfNull(matches);
        ArgumentNullException.ThrowIfNull(memberships);
        ArgumentNullException.ThrowIfNull(squads);
        ArgumentNullException.ThrowIfNull(unitOfWork);
        ArgumentNullException.ThrowIfNull(clock);
        ArgumentNullException.ThrowIfNull(publisher);
        ArgumentNullException.ThrowIfNull(logger);

        _matches = matches;
        _memberships = memberships;
        _squads = squads;
        _unitOfWork = unitOfWork;
        _clock = clock;
        _publisher = publisher;
        _logger = logger;
    }

    /// <summary>
    /// Handles a <see cref="CreateMatchDraftCommand"/>, returning the created match's identity on
    /// success or a typed <see cref="MatchError"/> when the actor is not an organiser or the draft
    /// fails validation.
    /// </summary>
    /// <param name="command">The draft-creation request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result<CreateMatchDraftResult>> HandleAsync(
        CreateMatchDraftCommand command,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        if (command.ActingUserId == Guid.Empty)
        {
            return Fail(MatchErrorCode.ValidationFailed, "An acting user identifier is required.");
        }

        if (command.SquadId == Guid.Empty)
        {
            return Fail(MatchErrorCode.ValidationFailed, "A squad identifier is required.");
        }

        // Resolve the acting membership and gate: only an active registered owner or admin may draft a
        // match. The failure is uniform and discloses neither the squad nor the membership
        // (Requirement 1.2, 14.1, 14.2).
        SquadMembership? acting =
            await _memberships.GetByUserAndSquadAsync(command.ActingUserId, command.SquadId, cancellationToken);

        Result gate = MatchAuthorization.RequireOrganiser(acting);
        if (!gate.IsSuccess)
        {
            return Result<CreateMatchDraftResult>.Fail(gate.Error!);
        }

        // Build the draft on the aggregate; a non-empty client-supplied id is retained, else a fresh
        // GUID v7 is generated (Requirement 13.1). Validation lives on the aggregate (Requirement 1.3-1.6).
        Guid matchId = command.MatchId ?? Guid.Empty;
        Result<Match> created = Match.CreateDraft(
            matchId,
            command.SquadId,
            command.Location ?? string.Empty,
            command.CandidateDays ?? [],
            _clock.GetUtcNow());
        if (!created.IsSuccess)
        {
            return Result<CreateMatchDraftResult>.Fail(created.Error!);
        }

        Match match = created.Value!;

        await _matches.AddAsync(match, cancellationToken);

        // Persist the draft atomically; a failed commit persists no match (Requirement 1.1).
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        // Only after the creation has committed successfully, raise exactly one MatchDrafted event.
        // The publish is best-effort and fully isolated (Requirement 3.1, 3.2, 3.3).
        await PublishMatchDraftedAsync(match, cancellationToken);

        return Result<CreateMatchDraftResult>.Ok(new CreateMatchDraftResult(match.Id));
    }

    /// <summary>
    /// Publishes the single <see cref="NotificationType.MatchDrafted"/> broadcast for a freshly
    /// committed match, owned by the match's squad; the publisher resolves recipients from the squad's
    /// active registered memberships. The whole attempt is best-effort and fully isolated: any failure
    /// result or thrown exception is caught, logged without contact PII — only the notification type,
    /// the squad id, the match id, and a failure reason — and swallowed, so the already-committed match
    /// is never rolled back and the failure never surfaces to the caller (Requirement 3.1, 3.2, 3.3).
    /// </summary>
    private async Task PublishMatchDraftedAsync(Match match, CancellationToken cancellationToken)
    {
        try
        {
            Squad? squad = await _squads.GetByIdAsync(match.SquadId, cancellationToken);
            var context = new NotificationContext
            {
                SquadName = squad?.Name ?? string.Empty,
                MatchLocation = match.Location,
            };

            PitchMate.Domain.Notifications.Result published = await _publisher.PublishAsync(
                NotificationType.MatchDrafted,
                match.SquadId,
                directedTargetMembershipIds: [],
                context,
                cancellationToken);

            if (!published.IsSuccess)
            {
                _logger.LogWarning(
                    "Notification publish failed after committed match draft (isolated; draft retained). "
                    + "Type={NotificationType}, SquadId={SquadId}, MatchId={MatchId}, Reason={Reason}",
                    NotificationType.MatchDrafted, match.SquadId, match.Id,
                    published.Error?.Code.ToString() ?? "Unknown");
            }
        }
        catch (Exception ex) when (ex is not OutOfMemoryException and not StackOverflowException)
        {
            // The draft is already committed; isolate every publish failure so it is never rolled back
            // and never surfaces to the caller. Log identifiers and the exception type only — no PII
            // (Requirement 3.3).
            _logger.LogWarning(
                "Notification publish threw after committed match draft (isolated; draft retained). "
                + "Type={NotificationType}, SquadId={SquadId}, MatchId={MatchId}, Reason={Reason}",
                NotificationType.MatchDrafted, match.SquadId, match.Id, ex.GetType().Name);
        }
    }

    private static Result<CreateMatchDraftResult> Fail(MatchErrorCode code, string message) =>
        Result<CreateMatchDraftResult>.Fail(new MatchError(code, message));
}
