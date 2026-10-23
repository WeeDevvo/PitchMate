using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Squads;

namespace PitchMate.Application.Squads.UseCases;

/// <summary>A claim link that can still be accepted, with the guest and squad it belongs to.</summary>
/// <param name="Claim">The pending, unexpired claim.</param>
/// <param name="Guest">The guest membership it claims.</param>
/// <param name="Squad">The live squad the guest belongs to.</param>
internal sealed record UsableGuestClaimLink(GuestClaim Claim, SquadMembership Guest, Squad Squad);

/// <summary>
/// Resolves a presented claim-link secret to a link that can still be accepted, or to nothing. Every way
/// a link can be unusable resolves to the same <see langword="null"/>, which the callers turn into the
/// one uniform failure in <see cref="GuestClaimLinkFailures"/>.
/// </summary>
internal static class GuestClaimLinkResolver
{
    /// <summary>
    /// The usable link <paramref name="presentedSecret"/> names at <paramref name="now"/>, or
    /// <see langword="null"/> when the secret is blank or unknown, the claim is not pending or has
    /// expired, the membership is no longer a guest, or the squad is pending deletion.
    /// </summary>
    public static async Task<UsableGuestClaimLink?> ResolveAsync(
        string presentedSecret,
        DateTimeOffset now,
        IClaimSecretService secrets,
        IGuestClaimRepository claims,
        ISquadMembershipRepository memberships,
        ISquadRepository squads,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(presentedSecret))
        {
            return null;
        }

        GuestClaim? claim = await claims.FindByTokenHashAsync(secrets.Hash(presentedSecret), cancellationToken);
        if (claim is null || !claim.IsRedeemableAt(now))
        {
            return null;
        }

        SquadMembership? guest = await memberships.GetByIdAsync(claim.MembershipId, cancellationToken);
        if (guest is null || !guest.IsGuest)
        {
            return null;
        }

        // The ordinary squad load hides a squad pending deletion, which is what makes its links unusable.
        Squad? squad = await squads.GetByIdAsync(guest.SquadId, cancellationToken);
        return squad is null ? null : new UsableGuestClaimLink(claim, guest, squad);
    }
}
