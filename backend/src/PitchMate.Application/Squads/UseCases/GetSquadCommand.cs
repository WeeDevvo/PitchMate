namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// A request by an authenticated user to read a squad's data (Requirement 16.1, 16.2). The data is
/// returned only when the requester holds an <c>Active</c> membership in the target squad; any other
/// requester receives a uniform authorisation failure that discloses no data and does not reveal
/// whether the squad exists.
/// </summary>
/// <param name="RequestingUserId">The authenticated user requesting the squad's data.</param>
/// <param name="SquadId">The squad whose data is requested.</param>
public sealed record GetSquadCommand(Guid RequestingUserId, Guid SquadId);
