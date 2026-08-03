using Microsoft.Extensions.Logging;
using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Notifications;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Matches;

// PitchMate.Domain.Matches, PitchMate.Domain.Rating, and PitchMate.Domain.Squads each define a
// Result / Result<T> triad. Import only the Matches namespace above so the unqualified Result /
// Result<T> in this handler binds to the Matches triad, and pull in the specific rating and squad
// types by alias rather than importing those namespaces wholesale (mirroring
// TeamBalanceRequestFactory / CreateMatchDraftHandler). The rating-engine operations return the
// PitchMate.Domain.Rating Result<T>, which is aliased explicitly so it is never confused with the
// Matches Result<T> the handler itself returns.
using NotificationType = PitchMate.Domain.Notifications.NotificationType;
using Squad = PitchMate.Domain.Squads.Squad;
using SquadMembership = PitchMate.Domain.Squads.SquadMembership;
using IRatingEngine = PitchMate.Domain.Rating.IRatingEngine;
using SkillTier = PitchMate.Domain.Rating.SkillTier;
using PlayerRating = PitchMate.Domain.Rating.Rating;
using RatingMatchOutcome = PitchMate.Domain.Rating.MatchOutcome;
using RatingMatchUpdate = PitchMate.Domain.Rating.MatchUpdate;
// IRatingEngine.CreateRating and UpdateRatings return the rating-namespace Result<T>; alias each so
// the seed/update call results are explicit and distinct from the Matches Result<T> used elsewhere.
using RatingSeedResult = PitchMate.Domain.Rating.Result<PitchMate.Domain.Rating.Rating>;
using RatingUpdateResult = PitchMate.Domain.Rating.Result<PitchMate.Domain.Rating.MatchUpdate>;

namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// Completes an in-progress match: it applies the match's single rating update over the immutable
/// kickoff lineup and, in one atomic transaction, sets the completion instant, updates each
/// participating membership's current rating, and writes one <see cref="RatingSnapshot"/> per
/// participant (Requirement 12.1, 12.2, 12.3, 13.2, 10.1, 10.4). The handler loads the squad-scoped
/// match, resolves the acting user's membership in that match's squad, and gates through
/// <see cref="MatchAuthorization.RequireOrganiser"/>, so only an active registered owner or admin may
/// complete; every other actor — and a match that cannot be found — is rejected with a single uniform
/// <see cref="MatchErrorCode.Unauthorized"/> failure that discloses neither the squad nor whether the
/// match exists and changes nothing (Requirement 14.1, 14.2).
/// <para>
/// Completion is idempotent (Requirement 12.7, 13.2, 13.5, 10.5). A match already in
/// <see cref="MatchState.Completed"/> is a success no-op that returns the originally recorded result
/// and applies no further rating update. For an <see cref="MatchState.InProgress"/> match the handler
/// derives the outcome from the captured <c>KickoffLineup</c> via <see cref="Match.DeriveOutcome"/>,
/// loads each participant's <see cref="MembershipRating"/> — seeding an absent one in memory from its
/// <see cref="SquadMembership.SkillTier"/> via <see cref="IRatingEngine.CreateRating"/> — and applies
/// exactly one <see cref="IRatingEngine.UpdateRatings"/> over the kickoff-derived outcome
/// (Requirement 12.1, 12.2, 10.4). It then sets <c>CompletedAt</c> via <see cref="Match.Complete"/>,
/// overwrites each membership's current rating with the engine's output, and captures one snapshot
/// per participant, committing the lot atomically through <see cref="IUnitOfWork.SaveChangesAsync"/>.
/// </para>
/// <para>
/// The match-state guard plus the row's <c>xmin</c> optimistic-concurrency token make the update
/// apply at most once: two concurrent completions both read <see cref="MatchState.InProgress"/>, but
/// only one commit wins; the loser's commit raises a <see cref="ConcurrencyConflictException"/>, upon
/// which the handler reloads the match, observes it is now <see cref="MatchState.Completed"/>, and
/// returns the existing recorded result without applying a second update (Requirement 13.4, 13.6,
/// 12.7).
/// </para>
/// <para>
/// Only after a successful commit does the handler raise exactly one
/// <see cref="NotificationType.ResultPosted"/> event (a broadcast owned by the match's squad) in a
/// fully isolated best-effort block: any failure result or thrown exception is caught, logged without
/// contact PII, and swallowed, so a publish failure never rolls back the committed completion and
/// never surfaces to the caller (Requirement 12.6).
/// </para>
/// </summary>
public sealed class CompleteMatchHandler
{
    private readonly IMatchRepository _matches;
    private readonly IMembershipRatingRepository _ratings;
    private readonly IRepository<RatingSnapshot> _snapshots;
    private readonly ISquadMembershipRepository _memberships;
    private readonly ISquadRepository _squads;
    private readonly IRatingEngine _ratingEngine;
    private readonly IUnitOfWork _unitOfWork;
    private readonly TimeProvider _clock;
    private readonly INotificationPublisher _publisher;
    private readonly ILogger<CompleteMatchHandler> _logger;

    /// <summary>
    /// Creates the handler with the match repository it loads the squad-scoped match through, the
    /// membership-rating repository it reads and seeds current ratings through, the snapshot repository
    /// it writes per-participant snapshots through, the membership repository it resolves and gates the
    /// acting membership and reads skill tiers through, the squad repository it reads the squad name
    /// from for notification rendering, the rating engine it seeds cold-start ratings and applies the
    /// single rating update with, the unit of work it commits the completion transaction through, the
    /// clock it stamps the completion instant with, the notification publisher it raises the
    /// <c>ResultPosted</c> event through after a committed completion, and the logger it records an
    /// isolated publish failure with.
    /// </summary>
    public CompleteMatchHandler(
        IMatchRepository matches,
        IMembershipRatingRepository ratings,
        IRepository<RatingSnapshot> snapshots,
        ISquadMembershipRepository memberships,
        ISquadRepository squads,
        IRatingEngine ratingEngine,
        IUnitOfWork unitOfWork,
        TimeProvider clock,
        INotificationPublisher publisher,
        ILogger<CompleteMatchHandler> logger)
    {
        ArgumentNullException.ThrowIfNull(matches);
        ArgumentNullException.ThrowIfNull(ratings);
        ArgumentNullException.ThrowIfNull(snapshots);
        ArgumentNullException.ThrowIfNull(memberships);
        ArgumentNullException.ThrowIfNull(squads);
        ArgumentNullException.ThrowIfNull(ratingEngine);
        ArgumentNullException.ThrowIfNull(unitOfWork);
        ArgumentNullException.ThrowIfNull(clock);
        ArgumentNullException.ThrowIfNull(publisher);
        ArgumentNullException.ThrowIfNull(logger);

        _matches = matches;
        _ratings = ratings;
        _snapshots = snapshots;
        _memberships = memberships;
        _squads = squads;
        _ratingEngine = ratingEngine;
        _unitOfWork = unitOfWork;
        _clock = clock;
        _publisher = publisher;
        _logger = logger;
    }

    /// <summary>
    /// Handles a <see cref="CompleteMatchCommand"/>, returning the completed match's identity,
    /// completion instant, and recorded result on success (or on an idempotent already-completed
    /// no-op), or a typed <see cref="MatchError"/> — a uniform authorisation failure for a
    /// non-organiser or an unfindable match, a state failure when the match is not in progress, a
    /// result-required failure when no result is recorded, or a concurrency-conflict failure when a
    /// concurrent completion won a race that did not resolve to a completed match.
    /// </summary>
    /// <param name="command">The completion request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result<CompleteMatchResult>> HandleAsync(
        CompleteMatchCommand command,
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

        // Resolve the acting membership and gate: only an active registered owner or admin may
        // complete; every other actor is rejected with the uniform failure that changes nothing
        // (Requirement 14.1, 14.2).
        SquadMembership? acting =
            await _memberships.GetByUserAndSquadAsync(command.ActingUserId, match.SquadId, cancellationToken);

        Result gate = MatchAuthorization.RequireOrganiser(acting);
        if (!gate.IsSuccess)
        {
            return Result<CompleteMatchResult>.Fail(gate.Error!);
        }

        // Idempotent no-op: a match already completed returns its originally recorded result and
        // applies no further rating update (Requirement 12.7, 13.2, 13.5).
        if (match.State == MatchState.Completed)
        {
            return BuildAlreadyCompletedResult(match);
        }

        // A precise state error when the match is neither in progress nor already completed
        // (Requirement 12.8, 2.5).
        if (match.State != MatchState.InProgress)
        {
            return Fail(
                MatchErrorCode.InvalidState,
                $"Match must be in {MatchState.InProgress} for this operation, but is {match.State}.");
        }

        // Load (or seed) the current rating of every participant so the outcome can be derived and the
        // update applied over the kickoff lineup. Seeding an absent rating from the membership's skill
        // tier gives a cold-start rating for a member's first completed match (Requirement 12.1).
        Result<RatingsByMembership> loaded = await LoadOrSeedRatingsAsync(match, cancellationToken);
        if (!loaded.IsSuccess)
        {
            return Result<CompleteMatchResult>.Fail(loaded.Error!);
        }

        RatingsByMembership ratings = loaded.Value!;

        // Derive the outcome solely from the immutable kickoff lineup; this fails with ResultRequired
        // when no result is recorded and with InvalidState before a lineup is captured
        // (Requirement 10.1, 10.4, 12.2, 12.5).
        Result<RatingMatchOutcome> derived = match.DeriveOutcome(ratings.PlayerRatings);
        if (!derived.IsSuccess)
        {
            return Result<CompleteMatchResult>.Fail(derived.Error!);
        }

        // Apply exactly one rating update over the kickoff-derived outcome (Requirement 12.1, 12.2).
        RatingUpdateResult updated = _ratingEngine.UpdateRatings(derived.Value!);
        if (!updated.IsSuccess)
        {
            return Fail(
                MatchErrorCode.ValidationFailed,
                $"The rating update could not be applied: {updated.Error?.Message}");
        }

        // Map the engine output back to memberships by the kickoff lineup's preserved ordering, staging
        // the current-rating overwrites and one snapshot per participant (Requirement 12.1).
        Result stage = await StageRatingUpdateAsync(match, ratings, updated.Value!, cancellationToken);
        if (!stage.IsSuccess)
        {
            return Result<CompleteMatchResult>.Fail(stage.Error!);
        }

        // Set the completion instant and transition to Completed on the aggregate. The state guard here
        // plus the xmin token make the completion apply at most once (Requirement 12.1, 13.4, 13.6).
        Result completed = match.Complete(_clock.GetUtcNow());
        if (!completed.IsSuccess)
        {
            return Result<CompleteMatchResult>.Fail(completed.Error!);
        }

        try
        {
            // Commit the completion, the seeded/updated ratings, and the snapshots as one atomic
            // transaction (Requirement 12.1).
            await _unitOfWork.SaveChangesAsync(cancellationToken);
        }
        catch (ConcurrencyConflictException)
        {
            // Another completion won the race on the xmin-guarded row. Reload and, if the match is now
            // completed, return its recorded result as an idempotent success applying no second update;
            // otherwise surface the conflict (Requirement 13.4, 13.6, 12.7).
            Match? reloaded = await _matches.GetByIdAsync(command.MatchId, cancellationToken);
            if (reloaded is not null && reloaded.State == MatchState.Completed)
            {
                return BuildAlreadyCompletedResult(reloaded);
            }

            return Fail(
                MatchErrorCode.ConcurrencyConflict,
                "The match was modified by another operation during completion; please retry.");
        }

        // Only after the completion has committed successfully, raise exactly one ResultPosted event.
        // The publish is best-effort and fully isolated (Requirement 12.6).
        await PublishResultPostedAsync(match, cancellationToken);

        return BuildCompletedResult(match, alreadyCompleted: false);
    }

    /// <summary>
    /// Loads the current <see cref="MembershipRating"/> of every participant of <paramref name="match"/>,
    /// seeding an absent one in memory from its <see cref="SquadMembership.SkillTier"/> via
    /// <see cref="IRatingEngine.CreateRating"/> (Requirement 12.1). Returns the per-membership rating
    /// entities (so the completion transaction can overwrite each) alongside the plain rating values
    /// keyed by membership (as <see cref="Match.DeriveOutcome"/> expects), or a validation failure when
    /// a seed cannot be produced. Newly seeded ratings are staged for insert so a member's first
    /// completed match durably creates its rating.
    /// </summary>
    private async Task<Result<RatingsByMembership>> LoadOrSeedRatingsAsync(
        Match match,
        CancellationToken cancellationToken)
    {
        // Read the squad's memberships once so an unrated participant can be seeded from its skill tier.
        IReadOnlyList<SquadMembership> squadMembers =
            await _memberships.ListForSquadAsync(match.SquadId, activeOnly: false, cancellationToken);
        Dictionary<Guid, SkillTier?> tierByMembership =
            squadMembers.ToDictionary(m => m.Id, m => m.SkillTier);

        var entities = new Dictionary<Guid, MembershipRating>();
        var playerRatings = new Dictionary<Guid, PlayerRating>();

        foreach (MatchParticipant participant in match.Participants)
        {
            Guid membershipId = participant.SquadMembershipId;
            if (entities.ContainsKey(membershipId))
            {
                continue;
            }

            MembershipRating? current = await _ratings.GetAsync(membershipId, cancellationToken);
            if (current is null)
            {
                SkillTier? tier = tierByMembership.TryGetValue(membershipId, out SkillTier? t) ? t : null;
                RatingSeedResult seeded = _ratingEngine.CreateRating(tier);
                if (!seeded.IsSuccess)
                {
                    return Result<RatingsByMembership>.Fail(new MatchError(
                        MatchErrorCode.ValidationFailed,
                        $"Could not seed a rating for participant {membershipId}: {seeded.Error?.Message}"));
                }

                current = MembershipRating.Create(membershipId, seeded.Value);
                await _ratings.AddAsync(current, cancellationToken);
            }

            entities[membershipId] = current;
            playerRatings[membershipId] = current.Rating;
        }

        return Result<RatingsByMembership>.Ok(new RatingsByMembership(entities, playerRatings));
    }

    /// <summary>
    /// Maps the engine's <see cref="RatingMatchUpdate"/> back to memberships by the kickoff lineup's
    /// preserved team-and-player ordering, overwriting each membership's current rating and staging one
    /// <see cref="RatingSnapshot"/> per participant carrying the post-update μ/σ (Requirement 12.1).
    /// Returns a validation failure when the engine output does not mirror the kickoff lineup shape,
    /// which would indicate an internal inconsistency rather than user input.
    /// </summary>
    private async Task<Result> StageRatingUpdateAsync(
        Match match,
        RatingsByMembership ratings,
        RatingMatchUpdate update,
        CancellationToken cancellationToken)
    {
        IReadOnlyList<KickoffTeam> kickoffTeams = match.KickoffLineup!.Teams;
        if (update.Teams.Count != kickoffTeams.Count)
        {
            return Result.Fail(new MatchError(
                MatchErrorCode.ValidationFailed,
                $"The rating update produced {update.Teams.Count} team(s) but the kickoff lineup has {kickoffTeams.Count}."));
        }

        for (var teamIndex = 0; teamIndex < kickoffTeams.Count; teamIndex++)
        {
            IReadOnlyList<Guid> rosterIds = kickoffTeams[teamIndex].ParticipantMembershipIds;
            IReadOnlyList<PlayerRating> updatedRatings = update.Teams[teamIndex];
            if (updatedRatings.Count != rosterIds.Count)
            {
                return Result.Fail(new MatchError(
                    MatchErrorCode.ValidationFailed,
                    $"The rating update produced {updatedRatings.Count} player rating(s) for team {teamIndex} but its roster has {rosterIds.Count}."));
            }

            for (var playerIndex = 0; playerIndex < rosterIds.Count; playerIndex++)
            {
                Guid membershipId = rosterIds[playerIndex];
                PlayerRating newRating = updatedRatings[playerIndex];

                if (!ratings.Entities.TryGetValue(membershipId, out MembershipRating? entity))
                {
                    return Result.Fail(new MatchError(
                        MatchErrorCode.ValidationFailed,
                        $"No membership rating was loaded for kickoff participant {membershipId}."));
                }

                entity.UpdateRating(newRating);
                await _snapshots.AddAsync(
                    RatingSnapshot.Capture(match.Id, membershipId, newRating),
                    cancellationToken);
            }
        }

        return Result.Ok();
    }

    /// <summary>
    /// Publishes the single <see cref="NotificationType.ResultPosted"/> broadcast for a freshly
    /// committed completion, owned by the match's squad; the publisher resolves recipients from the
    /// squad's active registered memberships. The whole attempt is best-effort and fully isolated: any
    /// failure result or thrown exception is caught, logged without contact PII — only the notification
    /// type, the squad id, the match id, and a failure reason — and swallowed, so the already-committed
    /// completion is never rolled back and the failure never surfaces to the caller (Requirement 12.6).
    /// </summary>
    private async Task PublishResultPostedAsync(Match match, CancellationToken cancellationToken)
    {
        try
        {
            Squad? squad = await _squads.GetByIdAsync(match.SquadId, cancellationToken);
            var context = new NotificationContext
            {
                SquadName = squad?.Name ?? string.Empty,
                MatchLocation = match.Location,
                MatchScheduledFor = match.ConfirmedDay?.Instant,
            };

            PitchMate.Domain.Notifications.Result published = await _publisher.PublishAsync(
                NotificationType.ResultPosted,
                match.SquadId,
                directedTargetMembershipIds: [],
                context,
                cancellationToken);

            if (!published.IsSuccess)
            {
                _logger.LogWarning(
                    "Notification publish failed after committed match completion (isolated; completion retained). "
                    + "Type={NotificationType}, SquadId={SquadId}, MatchId={MatchId}, Reason={Reason}",
                    NotificationType.ResultPosted, match.SquadId, match.Id,
                    published.Error?.Code.ToString() ?? "Unknown");
            }
        }
        catch (Exception ex) when (ex is not OutOfMemoryException and not StackOverflowException)
        {
            // The completion is already committed; isolate every publish failure so it is never rolled
            // back and never surfaces to the caller. Log identifiers and the exception type only — no
            // PII (Requirement 12.6).
            _logger.LogWarning(
                "Notification publish threw after committed match completion (isolated; completion retained). "
                + "Type={NotificationType}, SquadId={SquadId}, MatchId={MatchId}, Reason={Reason}",
                NotificationType.ResultPosted, match.SquadId, match.Id, ex.GetType().Name);
        }
    }

    /// <summary>
    /// Builds the success result for an already-completed match, returning its originally recorded
    /// result and completion instant with <see cref="CompleteMatchResult.AlreadyCompleted"/> set
    /// (Requirement 12.7).
    /// </summary>
    private static Result<CompleteMatchResult> BuildAlreadyCompletedResult(Match match) =>
        BuildCompletedResult(match, alreadyCompleted: true);

    /// <summary>
    /// Projects the completed match's identity, completion instant, and recorded result into a
    /// <see cref="CompleteMatchResult"/>. A completed match always carries both a completion instant
    /// and a recorded result.
    /// </summary>
    private static Result<CompleteMatchResult> BuildCompletedResult(Match match, bool alreadyCompleted)
    {
        MatchResult? recorded = match.RecordedResult;
        ResultFidelity fidelity = recorded?.Fidelity ?? ResultFidelity.Basic;
        IReadOnlyList<TeamScore> teamScores = recorded?.TeamScores ?? [];

        return Result<CompleteMatchResult>.Ok(new CompleteMatchResult(
            match.Id,
            match.CompletedAt ?? default,
            fidelity,
            teamScores,
            alreadyCompleted));
    }

    private static Result<CompleteMatchResult> Unauthorized() =>
        Result<CompleteMatchResult>.Fail(new MatchError(
            MatchErrorCode.Unauthorized, "The requested action is not permitted."));

    private static Result<CompleteMatchResult> Fail(MatchErrorCode code, string message) =>
        Result<CompleteMatchResult>.Fail(new MatchError(code, message));

    /// <summary>
    /// The per-participant rating view assembled for completion: the mutable
    /// <see cref="MembershipRating"/> entities to overwrite (keyed by membership) and the plain rating
    /// values keyed by membership that <see cref="Match.DeriveOutcome"/> consumes.
    /// </summary>
    private sealed record RatingsByMembership(
        IReadOnlyDictionary<Guid, MembershipRating> Entities,
        IReadOnlyDictionary<Guid, PlayerRating> PlayerRatings);
}
