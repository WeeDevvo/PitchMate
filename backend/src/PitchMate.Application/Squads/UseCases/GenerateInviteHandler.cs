using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Squads;

namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// Generates a shareable invite link and short code for a squad (Requirement 10). The handler resolves
/// the acting membership from the authenticated user and target squad and gates it through
/// <see cref="SquadAuthorization.RequireOwnerOrAdmin"/>, so only an active owner or admin may generate
/// an invite and every other actor is rejected with a uniform authorisation failure that creates no
/// invite (Requirement 10.8).
/// <para>
/// It then resolves the expiry instant. An expiring request expires at the clock instant plus the
/// requested validity, defaulting to 7 days when none is supplied, and a supplied validity outside
/// 1 hour to 90 days is rejected as a validation failure with no invite created (Requirement 10.2,
/// 10.9). A non-expiring request is honoured only where configuration permits it; otherwise it alone
/// is rejected with <see cref="SquadErrorCode.ExpiryRequired"/> while expiring requests continue to be
/// accepted (Requirement 10.3).
/// </para>
/// <para>
/// Before creating the invite it enforces the per-squad cap of
/// <see cref="Invite.MaxActivePerSquad"/> concurrent active invites, rejecting a request that would
/// exceed it with <see cref="SquadErrorCode.InviteLimitReached"/> and creating no invite
/// (Requirement 10.6, 10.10). On success it generates a fresh secret via
/// <see cref="IInviteSecretService.Generate"/>, persists only its one-way hash through
/// <see cref="IUnitOfWork.SaveChangesAsync"/>, and returns the redeemable link and code to the caller
/// exactly once (Requirement 10.1).
/// </para>
/// </summary>
public sealed class GenerateInviteHandler
{
    private readonly ISquadMembershipRepository _memberships;
    private readonly IInviteRepository _invites;
    private readonly IInviteSecretService _inviteSecrets;
    private readonly IUnitOfWork _unitOfWork;
    private readonly TimeProvider _clock;
    private readonly InviteOptions _options;

    /// <summary>
    /// Creates the handler with the membership repository it authorises through, the invite repository
    /// it counts active invites in and stages the insert into, the invite secret service it generates
    /// the one-time secret with, the unit of work it commits through, the clock it derives the expiry
    /// instant from, and the options governing the non-expiring-invite policy.
    /// </summary>
    public GenerateInviteHandler(
        ISquadMembershipRepository memberships,
        IInviteRepository invites,
        IInviteSecretService inviteSecrets,
        IUnitOfWork unitOfWork,
        TimeProvider clock,
        InviteOptions options)
    {
        ArgumentNullException.ThrowIfNull(memberships);
        ArgumentNullException.ThrowIfNull(invites);
        ArgumentNullException.ThrowIfNull(inviteSecrets);
        ArgumentNullException.ThrowIfNull(unitOfWork);
        ArgumentNullException.ThrowIfNull(clock);
        ArgumentNullException.ThrowIfNull(options);

        _memberships = memberships;
        _invites = invites;
        _inviteSecrets = inviteSecrets;
        _unitOfWork = unitOfWork;
        _clock = clock;
        _options = options;
    }

    /// <summary>
    /// Handles a <see cref="GenerateInviteCommand"/>, returning the created invite's identity and its
    /// one-time redeemable link and code on success, or a typed <see cref="SquadError"/> when
    /// authorisation, the expiry policy, or the active-invite cap rejects the request.
    /// </summary>
    /// <param name="command">The invite-generation request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result<GenerateInviteResult>> HandleAsync(
        GenerateInviteCommand command,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        SquadMembership? acting =
            await _memberships.GetByUserAndSquadAsync(command.ActingUserId, command.SquadId, cancellationToken);

        // Only an active owner or admin may generate an invite; every other actor is rejected
        // uniformly and no invite is created (Requirement 10.8).
        Result gate = SquadAuthorization.RequireOwnerOrAdmin(acting);
        if (!gate.IsSuccess)
        {
            return Result<GenerateInviteResult>.Fail(gate.Error!);
        }

        // A squad that is pending deletion rejects every action except export and reversal; the check
        // runs only after authorisation, so a non-member never learns the squad's state and no invite
        // is created (Requirement 17.3).
        if (await _memberships.IsSquadPendingDeletionAsync(command.SquadId, cancellationToken))
        {
            return Fail(
                SquadErrorCode.SquadPendingDeletion,
                "The squad is pending deletion; only exporting the squad and reversing the deletion are permitted.");
        }

        // Resolve the expiry instant, enforcing the validity range and the non-expiring policy
        // (Requirement 10.2, 10.3, 10.9).
        Result<DateTimeOffset?> expiry = ResolveExpiry(command);
        if (!expiry.IsSuccess)
        {
            return Result<GenerateInviteResult>.Fail(expiry.Error!);
        }

        // Enforce the per-squad active-invite cap before creating another (Requirement 10.6, 10.10).
        int activeInvites = await _invites.CountActiveAsync(command.SquadId, cancellationToken);
        if (activeInvites >= Invite.MaxActivePerSquad)
        {
            return Fail(
                SquadErrorCode.InviteLimitReached,
                "The squad has reached the maximum number of active invites.");
        }

        // Generate the one-time secret; only its one-way hash is persisted (Requirement 10.1).
        InviteSecret secret = _inviteSecrets.Generate();
        Invite invite = Invite.Create(command.SquadId, secret.TokenHash, expiry.Value);

        await _invites.AddAsync(invite, cancellationToken);
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        // Return the redeemable link and code to the caller exactly once (Requirement 10.1).
        return Result<GenerateInviteResult>.Ok(new GenerateInviteResult(
            invite.Id,
            secret.RedeemableLink,
            secret.Code,
            invite.ExpiresAt));
    }

    private Result<DateTimeOffset?> ResolveExpiry(GenerateInviteCommand command)
    {
        // A non-expiring invite is honoured only where configuration permits it; otherwise this
        // request alone is rejected while expiring requests continue to be accepted (Requirement 10.3).
        if (command.NonExpiring)
        {
            return _options.AllowNonExpiringInvites
                ? Result<DateTimeOffset?>.Ok(null)
                : Result<DateTimeOffset?>.Fail(new SquadError(
                    SquadErrorCode.ExpiryRequired,
                    "An expiry is required because non-expiring invites are not permitted."));
        }

        // Default the validity to 7 days when none is supplied (Requirement 10.2).
        TimeSpan validity = command.Validity ?? Invite.DefaultValidity;

        // Reject a validity period shorter than 1 hour or longer than 90 days (Requirement 10.9).
        if (validity < Invite.MinValidity || validity > Invite.MaxValidity)
        {
            return Result<DateTimeOffset?>.Fail(new SquadError(
                SquadErrorCode.ValidationFailed,
                "The requested validity period must be between 1 hour and 90 days."));
        }

        // The expiry instant is the clock instant plus the validity period (Requirement 10.2).
        return Result<DateTimeOffset?>.Ok(_clock.GetUtcNow() + validity);
    }

    private static Result<GenerateInviteResult> Fail(SquadErrorCode code, string message) =>
        Result<GenerateInviteResult>.Fail(new SquadError(code, message));
}
