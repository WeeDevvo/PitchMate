namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// The identities produced by a successful squad creation: the new squad and the owner membership
/// created for the requesting user (Requirement 1.1).
/// </summary>
/// <param name="SquadId">The identity of the created squad.</param>
/// <param name="OwnerMembershipId">The identity of the created owner membership.</param>
public sealed record CreateSquadResult(Guid SquadId, Guid OwnerMembershipId);
