using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Squads;

namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// Tells a signed-in player what a claim link is for (the guest's name and the squad's) before they
/// accept it. Reads only; changes nothing. Every unusable link gets the one uniform failure from
/// <see cref="GuestClaimLinkFailures"/>, the same answer accepting it would give.
/// </summary>
public sealed class PreviewGuestClaimHandler
{
    private readonly IClaimSecretService _secrets;
    private readonly IGuestClaimRepository _claims;
    private readonly ISquadMembershipRepository _memberships;
    private readonly ISquadRepository _squads;
    private readonly TimeProvider _clock;

    /// <summary>Creates the handler with what it resolves the link through and judges expiry by.</summary>
    public PreviewGuestClaimHandler(
        IClaimSecretService secrets,
        IGuestClaimRepository claims,
        ISquadMembershipRepository memberships,
        ISquadRepository squads,
        TimeProvider clock)
    {
        ArgumentNullException.ThrowIfNull(secrets);
        ArgumentNullException.ThrowIfNull(claims);
        ArgumentNullException.ThrowIfNull(memberships);
        ArgumentNullException.ThrowIfNull(squads);
        ArgumentNullException.ThrowIfNull(clock);

        _secrets = secrets;
        _claims = claims;
        _memberships = memberships;
        _squads = squads;
        _clock = clock;
    }

    /// <summary>Handles a <see cref="PreviewGuestClaimCommand"/>.</summary>
    /// <param name="command">The request.</param>
    /// <param name="cancellationToken">A token to cancel the operation.</param>
    public async Task<Result<GuestClaimPreview>> HandleAsync(
        PreviewGuestClaimCommand command,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(command);

        UsableGuestClaimLink? link = await GuestClaimLinkResolver.ResolveAsync(
            command.PresentedSecret,
            _clock.GetUtcNow(),
            _secrets,
            _claims,
            _memberships,
            _squads,
            cancellationToken);

        return link is null
            ? Result<GuestClaimPreview>.Fail(GuestClaimLinkFailures.Unusable())
            : Result<GuestClaimPreview>.Ok(new GuestClaimPreview(link.Squad.Name, link.Guest.DisplayName));
    }
}
