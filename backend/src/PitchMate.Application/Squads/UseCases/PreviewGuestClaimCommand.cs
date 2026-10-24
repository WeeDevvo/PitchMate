namespace PitchMate.Application.Squads.UseCases;

/// <summary>A signed-in player asking what a claim link is for, before accepting it.</summary>
/// <param name="ActingUserId">The authenticated user asking.</param>
/// <param name="PresentedSecret">The secret from the link's path.</param>
public sealed record PreviewGuestClaimCommand(Guid ActingUserId, string PresentedSecret);
