namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// A request by an authenticated user for the list of squads they belong to (Requirement 16.4). The
/// result is exactly the set of non-deleted squads in which the user holds a membership.
/// </summary>
/// <param name="UserId">The authenticated user whose squads are listed.</param>
public sealed record ListMySquadsCommand(Guid UserId);
