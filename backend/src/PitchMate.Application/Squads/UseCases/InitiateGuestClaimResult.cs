namespace PitchMate.Application.Squads.UseCases;

/// <summary>An issued claim link, returned once: the only time the link itself is available.</summary>
/// <param name="ClaimId">The claim's identity.</param>
/// <param name="RedeemableLink">The link to hand to the player.</param>
/// <param name="ExpiresAt">When the link stops working.</param>
public sealed record InitiateGuestClaimResult(Guid ClaimId, string RedeemableLink, DateTimeOffset ExpiresAt);
