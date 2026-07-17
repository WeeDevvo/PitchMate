namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// A request by an authenticated user to read a squad's <c>SquadFeature</c> flag states
/// (Requirement 13.4, 13.8). The states are returned only when the requester holds an <c>Active</c>
/// membership in the target squad; any other requester receives a uniform authorisation failure that
/// discloses no feature state and does not reveal whether the squad exists.
/// </summary>
/// <param name="RequestingUserId">The authenticated user requesting the feature states.</param>
/// <param name="SquadId">The squad whose feature states are requested.</param>
public sealed record GetFeatureFlagsCommand(Guid RequestingUserId, Guid SquadId);
