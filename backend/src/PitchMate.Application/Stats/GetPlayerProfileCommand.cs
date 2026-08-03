namespace PitchMate.Application.Stats;

/// <summary>
/// A request by an authenticated user to read a squad-scoped <c>Player_Profile</c> (Requirement 3.1,
/// 3.6). The profile is returned only when the requester holds an <c>Active</c> membership in the
/// target squad and the subject membership belongs to that same squad; any other requester — or a
/// subject membership that does not belong to the squad — receives a uniform failure that discloses
/// neither existence nor any statistical data. The requester identity is always the authenticated
/// access-token subject, never a caller-supplied body/query value (Requirement 1.5).
/// </summary>
/// <param name="RequestingUserId">The authenticated user requesting the profile (from the token subject).</param>
/// <param name="SquadId">The squad the profile is scoped to.</param>
/// <param name="MembershipId">The subject membership whose profile is requested.</param>
public sealed record GetPlayerProfileCommand(Guid RequestingUserId, Guid SquadId, Guid MembershipId);
