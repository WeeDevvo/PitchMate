namespace PitchMate.Application.Squads.UseCases;

/// <summary>An owner or admin reading where each guest's claim stands.</summary>
/// <param name="ActingUserId">The authenticated user.</param>
/// <param name="SquadId">The squad.</param>
public sealed record ListGuestClaimsCommand(Guid ActingUserId, Guid SquadId);
