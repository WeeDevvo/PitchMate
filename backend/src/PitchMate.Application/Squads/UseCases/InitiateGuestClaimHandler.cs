using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Squads;

namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// Issues a one-time claim link for a guest membership. An active owner or admin of a live squad asks
/// for it; the target must be a guest of that squad. Any claim already open for the guest is cancelled
/// first, so a guest has at most one live link, and the new link expires after
/// <see cref="GuestClaim.LinkValidity"/>.
/// <para>
/// Only the hash of the link's secret is persisted. The link itself is in the result and nowhere else,
/// so this is the one time it can be shown. Who the link is for isn't known yet: the player who opens it
/// and accepts becomes the target (<see cref="AcceptGuestClaimHandler"/>), and an admin then completes
/// the claim. The cancellation and the new claim commit in one save.
/// </para>
/// </summary>
public sealed class InitiateGuestClaimHandler
{
    private readonly ISquadRepository _squads;
    private readonly ISquadMembershipRepository _memberships;
    private readonly IGuestClaimRepository _claims;
    private readonly IClaimSecretService _secrets;
    private readonly IUnitOfWork _unitOfWork;
    private readonly TimeProvider _clock;

    /// <summary>
    /// Creates the handler with the repositories it authorises and loads through, the secret service that
    /// issues the link, the unit of work it commits with, and the clock that sets the expiry.
    /// </summary>
    public InitiateGuestClaimHandler(
        ISquadRepository squads,
        ISquadMembershipRepository memberships,
        IGuestClaimRepository claims,
        IClaimSecretService secrets,
        IUnitOfWork unitOfWork,
        TimeProvider clock)
    {
        ArgumentNullException.ThrowIfNull(squads);
        ArgumentNullException.ThrowIfNull(memberships);
        ArgumentNullException.ThrowIfNull(claims);
        ArgumentNullException.ThrowIfNull(secrets);
        ArgumentNullException.ThrowIfNull(unitOfWork);
        ArgumentNullException.ThrowIfNull(clock);

        _squads = squads;
        _memberships = memberships;
        _claims = claims;
        _secrets = secrets;
        _unitOfWork = unitOfWork;
        _clock = clock;
    }

    /// <summary>
    /// Handles an <see cref="InitiateGuestClaimCommand"/>, returning the new link and its expiry, or a
    /// typed <see cref="SquadError"/> when authorisation or target eligibility fails.
    /// </summary>
    /// <param name="command">The request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result<InitiateGuestClaimResult>> HandleAsync(
        InitiateGuestClaimCommand command,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        SquadMembership? acting =
            await _memberships.GetByUserAndSquadAsync(command.ActingUserId, command.SquadId, cancellationToken);

        // Only an active owner or admin may issue a claim link; every other actor is rejected uniformly.
        Result gate = SquadAuthorization.RequireOwnerOrAdmin(acting);
        if (!gate.IsSuccess)
        {
            return Result<InitiateGuestClaimResult>.Fail(gate.Error!);
        }

        // A missing or pending-deletion squad yields the same uniform failure.
        Squad? squad = await _squads.GetByIdAsync(command.SquadId, cancellationToken);
        if (squad is null)
        {
            return Result<InitiateGuestClaimResult>.Fail(SquadAuthorization.RequireOwnerOrAdmin(null).Error!);
        }

        SquadMembership? target = await _memberships.GetByIdAsync(command.MembershipId, cancellationToken);
        if (target is null || target.SquadId != command.SquadId)
        {
            return Fail(SquadErrorCode.ClaimNotEligible, "The claim target is not a membership of this squad.");
        }

        if (!target.IsGuest)
        {
            return Fail(SquadErrorCode.ClaimNotEligible, "Only a guest membership can be claimed onto a user.");
        }

        DateTimeOffset now = _clock.GetUtcNow();

        // A newer link replaces any open one, so a forwarded old link stops working.
        GuestClaim? open = await _claims.GetOpenForMembershipAsync(command.MembershipId, cancellationToken);
        if (open is not null)
        {
            Result cancelled = open.Cancel(now);
            if (!cancelled.IsSuccess)
            {
                return Result<InitiateGuestClaimResult>.Fail(cancelled.Error!);
            }
        }

        ClaimSecret secret = _secrets.Generate();
        DateTimeOffset expiresAt = now + GuestClaim.LinkValidity;
        GuestClaim claim = GuestClaim.Initiate(command.MembershipId, secret.TokenHash, expiresAt);
        await _claims.AddAsync(claim, cancellationToken);

        // The cancellation and the new claim commit together; the issuing admin and instant are stamped
        // as audit by the persistence pipeline.
        await _unitOfWork.SaveChangesAsync(cancellationToken);

        return Result<InitiateGuestClaimResult>.Ok(
            new InitiateGuestClaimResult(claim.Id, secret.RedeemableLink, expiresAt));
    }

    private static Result<InitiateGuestClaimResult> Fail(SquadErrorCode code, string message) =>
        Result<InitiateGuestClaimResult>.Fail(new SquadError(code, message));
}
