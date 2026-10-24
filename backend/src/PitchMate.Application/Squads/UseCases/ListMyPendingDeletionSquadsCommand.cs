namespace PitchMate.Application.Squads.UseCases;

/// <summary>A request for the squads the user owns that are pending deletion.</summary>
/// <param name="UserId">The authenticated user.</param>
public sealed record ListMyPendingDeletionSquadsCommand(Guid UserId);
