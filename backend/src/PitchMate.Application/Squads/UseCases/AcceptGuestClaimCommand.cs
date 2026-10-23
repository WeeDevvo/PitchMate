namespace PitchMate.Application.Squads.UseCases;

/// <summary>A signed-in player accepting a claim link.</summary>
/// <param name="ActingUserId">The authenticated user accepting; they become the claim's target.</param>
/// <param name="PresentedSecret">The secret from the link's path.</param>
public sealed record AcceptGuestClaimCommand(Guid ActingUserId, string PresentedSecret);
