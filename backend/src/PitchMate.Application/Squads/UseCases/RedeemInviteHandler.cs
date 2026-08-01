using Microsoft.Extensions.Logging;
using PitchMate.Application.Auth.Abstractions;
using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Notifications;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Squads;
using NotificationType = PitchMate.Domain.Notifications.NotificationType;

namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// Redeems an invite secret to join a squad, reactivate a returning member, or confirm an existing
/// membership (Requirement 9, 11). The handler hashes the presented secret via
/// <see cref="IInviteSecretService.Hash"/> and resolves the invite by its stored one-way hash through
/// <see cref="IInviteRepository.FindByTokenHashAsync"/>, so the redeemable secret is never persisted
/// or compared directly (Requirement 10.4, 11.1). A presented value that matches no invite, or that
/// matches an invite which is not redeemable against the clock — revoked, or expired at or before the
/// current instant — is rejected with <see cref="SquadErrorCode.InviteUnusable"/> and creates no
/// membership (Requirement 9.2, 11.5, 12.2, 12.3).
/// <para>
/// It then resolves whether the user already holds a membership in the invite's squad via
/// <see cref="ISquadMembershipRepository.GetByUserAndSquadAsync"/>:
/// </para>
/// <list type="bullet">
/// <item>An active membership yields a no-op success reporting the user is already a member, creating
/// no second membership (Requirement 9.6, 11.3).</item>
/// <item>An inactive membership is reactivated in place via <see cref="SquadMembership.Reactivate"/>,
/// preserving its rating, stats, and history; an admin is downgraded to member while an owner is
/// retained, and a fresh unique display name is required only when the current one now collides
/// (Requirement 9.1, 9.3, 9.4, 9.5, 11.4).</item>
/// <item>No membership yields a new active registered <see cref="SquadRole.Member"/> membership with a
/// unique display name — the supplied name, or one derived from the user's identity display name when
/// none is supplied — created via <see cref="SquadMembership.CreateRegistered"/> (Requirement 11.1,
/// 11.7, 11.8).</item>
/// </list>
/// <para>
/// A supplied or derived display name whose trimmed length is outside 1..50 characters is a
/// validation failure, and one that collides with an existing non-anonymised membership is rejected
/// with <see cref="SquadErrorCode.DisplayNameInUse"/> so the caller can supply a distinct one; in
/// either case no membership is created and no reactivation completes (Requirement 9.5, 11.7, 11.8).
/// Every state change is committed atomically through <see cref="IUnitOfWork.SaveChangesAsync"/>, so a
/// failed commit leaves a new join unpersisted and a reactivating membership inactive (Requirement
/// 9.1, 11.1).
/// </para>
/// </summary>
public sealed class RedeemInviteHandler
{
    private readonly IInviteRepository _invites;
    private readonly ISquadMembershipRepository _memberships;
    private readonly IUserRepository _users;
    private readonly ISquadRepository _squads;
    private readonly IInviteSecretService _inviteSecrets;
    private readonly IUnitOfWork _unitOfWork;
    private readonly TimeProvider _clock;
    private readonly INotificationPublisher _publisher;
    private readonly ILogger<RedeemInviteHandler> _logger;

    /// <summary>
    /// Creates the handler with the invite repository it resolves the presented secret through, the
    /// membership repository it resolves the acting user's membership and display-name uniqueness in,
    /// the user repository it derives a default display name from, the squad repository it reads the
    /// squad name from for notification rendering, the invite secret service it hashes the presented
    /// secret with, the unit of work it commits through, the clock it validates the invite's
    /// redeemability against, the notification publisher it raises a <c>MemberJoined</c> notification
    /// through after a committed join, and the logger it records an isolated publish failure with.
    /// </summary>
    public RedeemInviteHandler(
        IInviteRepository invites,
        ISquadMembershipRepository memberships,
        IUserRepository users,
        ISquadRepository squads,
        IInviteSecretService inviteSecrets,
        IUnitOfWork unitOfWork,
        TimeProvider clock,
        INotificationPublisher publisher,
        ILogger<RedeemInviteHandler> logger)
    {
        ArgumentNullException.ThrowIfNull(invites);
        ArgumentNullException.ThrowIfNull(memberships);
        ArgumentNullException.ThrowIfNull(users);
        ArgumentNullException.ThrowIfNull(squads);
        ArgumentNullException.ThrowIfNull(inviteSecrets);
        ArgumentNullException.ThrowIfNull(unitOfWork);
        ArgumentNullException.ThrowIfNull(clock);
        ArgumentNullException.ThrowIfNull(publisher);
        ArgumentNullException.ThrowIfNull(logger);

        _invites = invites;
        _memberships = memberships;
        _users = users;
        _squads = squads;
        _inviteSecrets = inviteSecrets;
        _unitOfWork = unitOfWork;
        _clock = clock;
        _publisher = publisher;
        _logger = logger;
    }

    /// <summary>
    /// Handles a <see cref="RedeemInviteCommand"/>, returning the resolved membership and how the
    /// redemption resolved on success, or a typed <see cref="SquadError"/> when the invite is unusable
    /// or a display name is invalid or already in use.
    /// </summary>
    /// <param name="command">The redemption request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result<RedeemInviteResult>> HandleAsync(
        RedeemInviteCommand command,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        if (command.ActingUserId == Guid.Empty)
        {
            return Fail(SquadErrorCode.ValidationFailed, "An acting user identifier is required.");
        }

        if (string.IsNullOrWhiteSpace(command.PresentedSecret))
        {
            // An empty presentation matches no stored invite (Requirement 11.5).
            return Fail(SquadErrorCode.InviteUnusable, "The invite is invalid or no longer usable.");
        }

        // Resolve the invite by the one-way hash of the presented secret; the secret itself is never
        // stored or compared directly (Requirement 10.4, 11.1).
        string tokenHash = _inviteSecrets.Hash(command.PresentedSecret);
        Invite? invite = await _invites.FindByTokenHashAsync(tokenHash, cancellationToken);

        // No match, revoked, or expired against the clock is rejected uniformly with no membership
        // created (Requirement 9.2, 11.5, 12.2, 12.3).
        DateTimeOffset now = _clock.GetUtcNow();
        if (invite is null || !invite.IsRedeemableAt(now))
        {
            return Fail(SquadErrorCode.InviteUnusable, "The invite is invalid or no longer usable.");
        }

        // A squad that is pending deletion rejects every action except export and reversal, so a
        // redemption for it creates no membership even when the invite is otherwise redeemable
        // (Requirement 17.3).
        if (await _memberships.IsSquadPendingDeletionAsync(invite.SquadId, cancellationToken))
        {
            return Fail(
                SquadErrorCode.SquadPendingDeletion,
                "The squad is pending deletion; only exporting the squad and reversing the deletion are permitted.");
        }

        SquadMembership? existing =
            await _memberships.GetByUserAndSquadAsync(command.ActingUserId, invite.SquadId, cancellationToken);

        if (existing is not null)
        {
            return existing.State == MembershipState.Active
                ? Result<RedeemInviteResult>.Ok(new RedeemInviteResult(existing.Id, RedeemOutcome.AlreadyMember))
                : await ReactivateAsync(existing, invite.SquadId, command, cancellationToken);
        }

        return await JoinAsync(invite.SquadId, command, cancellationToken);
    }

    private async Task<Result<RedeemInviteResult>> ReactivateAsync(
        SquadMembership existing,
        Guid squadId,
        RedeemInviteCommand command,
        CancellationToken cancellationToken)
    {
        // Reactivation consults uniqueness against exactly one candidate name: the supplied
        // replacement, or the membership's current normalised name when none is supplied. Resolve
        // whether that candidate is taken by another non-anonymised membership up front, excluding the
        // reactivating membership itself (Requirement 9.5).
        string? candidate = command.DisplayName is not null
            ? Normalize(command.DisplayName)
            : existing.DisplayNameNormalized;

        bool nameTaken = candidate is not null
            && await _memberships.DisplayNameTakenAsync(squadId, candidate, existing.Id, cancellationToken);

        // Reactivate the same membership in place: preserves history, downgrades admin to member,
        // retains owner, and enforces the display-name rules (Requirement 9.1, 9.3, 9.4, 9.5, 11.4).
        Result reactivate = existing.Reactivate(command.DisplayName, _ => nameTaken);
        if (!reactivate.IsSuccess)
        {
            return Result<RedeemInviteResult>.Fail(reactivate.Error!);
        }

        // Commit the single-row reactivation; a failure leaves the membership inactive (Requirement 9.1).
        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return Result<RedeemInviteResult>.Ok(new RedeemInviteResult(existing.Id, RedeemOutcome.Reactivated));
    }

    private async Task<Result<RedeemInviteResult>> JoinAsync(
        Guid squadId,
        RedeemInviteCommand command,
        CancellationToken cancellationToken)
    {
        // Resolve the display name: the supplied value, or one derived from the user's identity
        // display name when none is supplied (Requirement 11.7).
        Result<string> displayName = await ResolveJoinDisplayNameAsync(command, cancellationToken);
        if (!displayName.IsSuccess)
        {
            return Result<RedeemInviteResult>.Fail(displayName.Error!);
        }

        // Build the new active registered member membership; the factory trims and enforces the
        // 1..50 length rule (Requirement 11.1, 11.8).
        Result<SquadMembership> created =
            SquadMembership.CreateRegistered(squadId, command.ActingUserId, displayName.Value!);
        if (!created.IsSuccess)
        {
            return Result<RedeemInviteResult>.Fail(created.Error!);
        }

        SquadMembership membership = created.Value!;

        // A supplied or derived name that collides with an existing non-anonymised membership is
        // rejected so the caller can supply a distinct one; no membership is created (Requirement
        // 11.7, 11.8).
        bool nameTaken = await _memberships.DisplayNameTakenAsync(
            squadId, membership.DisplayNameNormalized!, excludingMembershipId: null, cancellationToken);
        if (nameTaken)
        {
            return Fail(SquadErrorCode.DisplayNameInUse, "The requested display name is already in use in this squad.");
        }

        await _memberships.AddAsync(membership, cancellationToken);

        // Persist the new membership atomically; a failure persists no membership (Requirement 11.1).
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        // Only after the join has committed successfully, publish the MemberJoined notification to the
        // squad's active Owner and Admins, excluding the joiner. A publish failure is isolated and never
        // rolls back or surfaces from the committed join (Requirement 8.1, 8.5, 8.6, 8.8).
        await PublishMemberJoinedAsync(membership, cancellationToken);

        return Result<RedeemInviteResult>.Ok(new RedeemInviteResult(membership.Id, RedeemOutcome.Joined));
    }

    /// <summary>
    /// Publishes the <see cref="NotificationType.MemberJoined"/> notification for a freshly joined
    /// member, directed to the squad's active Owner and Admin registered memberships and excluding the
    /// joiner itself (Requirement 8.1). The whole attempt is best-effort and fully isolated: any failure
    /// Result or thrown exception is caught, logged without contact PII — only the
    /// <see cref="NotificationType"/>, the squad id, the joiner membership id, and a failure reason — and
    /// swallowed, so the already-committed join is never rolled back and the failure never surfaces to
    /// the caller (Requirement 8.5, 8.6, 8.8).
    /// </summary>
    private async Task PublishMemberJoinedAsync(SquadMembership joiner, CancellationToken cancellationToken)
    {
        try
        {
            // Resolve the recipients: the squad's active Owner and Admin registered memberships, minus
            // the joiner (a joiner is a plain Member, but exclude by id defensively) (Requirement 8.1).
            IReadOnlyList<SquadMembership> active =
                await _memberships.ListForSquadAsync(joiner.SquadId, activeOnly: true, cancellationToken);

            List<Guid> targets = active
                .Where(m => !m.IsGuest
                    && (m.Role == SquadRole.Owner || m.Role == SquadRole.Admin)
                    && m.Id != joiner.Id)
                .Select(m => m.Id)
                .ToList();

            // No Owner/Admin to notify (excluding the joiner) resolves to an empty directed set; nothing
            // to publish.
            if (targets.Count == 0)
            {
                return;
            }

            Squad? squad = await _squads.GetByIdAsync(joiner.SquadId, cancellationToken);
            var context = new NotificationContext
            {
                SquadName = squad?.Name ?? string.Empty,
                ActorDisplayName = joiner.DisplayName,
            };

            PitchMate.Domain.Notifications.Result published = await _publisher.PublishAsync(
                NotificationType.MemberJoined, joiner.SquadId, targets, context, cancellationToken);

            if (!published.IsSuccess)
            {
                _logger.LogWarning(
                    "Notification publish failed after committed squad join (isolated; join retained). "
                    + "Type={NotificationType}, SquadId={SquadId}, JoinerMembershipId={JoinerMembershipId}, "
                    + "RecipientCount={RecipientCount}, Reason={Reason}",
                    NotificationType.MemberJoined, joiner.SquadId, joiner.Id, targets.Count,
                    published.Error?.Code.ToString() ?? "Unknown");
            }
        }
        catch (Exception ex) when (ex is not OutOfMemoryException and not StackOverflowException)
        {
            // The join is already committed; isolate every publish failure so it is never rolled back and
            // never surfaces to the caller. Log identifiers and the exception type only — no contact PII
            // (Requirement 8.5, 8.6, 8.8).
            _logger.LogWarning(
                "Notification publish threw after committed squad join (isolated; join retained). "
                + "Type={NotificationType}, SquadId={SquadId}, JoinerMembershipId={JoinerMembershipId}, Reason={Reason}",
                NotificationType.MemberJoined, joiner.SquadId, joiner.Id, ex.GetType().Name);
        }
    }

    private async Task<Result<string>> ResolveJoinDisplayNameAsync(
        RedeemInviteCommand command,
        CancellationToken cancellationToken)
    {
        // A supplied display name (non-null) is used as-is; the membership factory trims it and
        // rejects a trimmed length outside 1..50 (Requirement 11.8).
        if (command.DisplayName is not null)
        {
            return Result<string>.Ok(command.DisplayName);
        }

        // No display name supplied: derive the default from the joining user's identity display name;
        // the membership factory validates its trimmed length (Requirement 11.7).
        Domain.Auth.User? user = await _users.GetByIdAsync(command.ActingUserId, cancellationToken);
        if (user is null)
        {
            return Result<string>.Fail(new SquadError(
                SquadErrorCode.ValidationFailed,
                "The joining user could not be found to derive a display name."));
        }

        return Result<string>.Ok(user.DisplayName);
    }

    private static string Normalize(string value) => value.Trim().ToLowerInvariant();

    private static Result<RedeemInviteResult> Fail(SquadErrorCode code, string message) =>
        Result<RedeemInviteResult>.Fail(new SquadError(code, message));
}
