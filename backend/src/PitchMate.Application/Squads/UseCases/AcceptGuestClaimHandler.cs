using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Squads;

namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// A signed-in player accepts a claim link. Accepting is the player's consent: it binds their account
/// as the claim's target and moves the claim to awaiting an admin's confirmation
/// (<see cref="CompleteGuestClaimHandler"/>). Nothing about the guest membership changes yet.
/// <para>
/// Every unusable link gets the one uniform failure from <see cref="GuestClaimLinkFailures"/>, so a
/// secret can't be probed. A player who already holds a membership in the squad, active or not, is
/// refused with <see cref="SquadErrorCode.AlreadyMember"/>, because completing would leave them with two;
/// they only learn that after presenting a usable secret.
/// </para>
/// </summary>
public sealed class AcceptGuestClaimHandler
{
    private readonly IClaimSecretService _secrets;
    private readonly IGuestClaimRepository _claims;
    private readonly ISquadMembershipRepository _memberships;
    private readonly ISquadRepository _squads;
    private readonly IUnitOfWork _unitOfWork;
    private readonly TimeProvider _clock;

    /// <summary>Creates the handler with what it resolves the link through, commits with, and judges expiry by.</summary>
    public AcceptGuestClaimHandler(
        IClaimSecretService secrets,
        IGuestClaimRepository claims,
        ISquadMembershipRepository memberships,
        ISquadRepository squads,
        IUnitOfWork unitOfWork,
        TimeProvider clock)
    {
        ArgumentNullException.ThrowIfNull(secrets);
        ArgumentNullException.ThrowIfNull(claims);
        ArgumentNullException.ThrowIfNull(memberships);
        ArgumentNullException.ThrowIfNull(squads);
        ArgumentNullException.ThrowIfNull(unitOfWork);
        ArgumentNullException.ThrowIfNull(clock);

        _secrets = secrets;
        _claims = claims;
        _memberships = memberships;
        _squads = squads;
        _unitOfWork = unitOfWork;
        _clock = clock;
    }

    /// <summary>
    /// Handles an <see cref="AcceptGuestClaimCommand"/>, returning the squad's name once the claim is
    /// accepted, or the uniform failure, or <see cref="SquadErrorCode.AlreadyMember"/>.
    /// </summary>
    /// <param name="command">The request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result<AcceptGuestClaimResult>> HandleAsync(
        AcceptGuestClaimCommand command,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        DateTimeOffset now = _clock.GetUtcNow();
        UsableGuestClaimLink? link = await GuestClaimLinkResolver.ResolveAsync(
            command.PresentedSecret, now, _secrets, _claims, _memberships, _squads, cancellationToken);
        if (link is null)
        {
            return Result<AcceptGuestClaimResult>.Fail(GuestClaimLinkFailures.Unusable());
        }

        SquadMembership? existing =
            await _memberships.GetByUserAndSquadAsync(command.ActingUserId, link.Guest.SquadId, cancellationToken);
        if (existing is not null)
        {
            return Result<AcceptGuestClaimResult>.Fail(new SquadError(
                SquadErrorCode.AlreadyMember,
                "You already belong to this squad, so this player can't be linked to your account."));
        }

        Result accepted = link.Claim.Accept(command.ActingUserId, now);
        if (!accepted.IsSuccess)
        {
            return Result<AcceptGuestClaimResult>.Fail(accepted.Error!);
        }

        await _unitOfWork.SaveChangesAsync(cancellationToken);
        return Result<AcceptGuestClaimResult>.Ok(new AcceptGuestClaimResult(link.Squad.Name));
    }
}
