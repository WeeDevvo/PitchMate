namespace PitchMate.Api.Squads.Endpoints;

/// <summary>
/// The response of the pre-join invite preview (Requirement 11.6). It deliberately carries <b>no</b>
/// squad data — no name, members, matches, or stats — and does not even reveal whether the presented
/// value matches a real, usable invite. It exists only to tell an unauthenticated visitor that they
/// must sign in or create an account and then redeem the invite to join. Any squad data is disclosed
/// only after the person has become an authenticated user and successfully joined.
/// </summary>
/// <param name="RequiresAuthentication">Always <see langword="true"/>: joining requires an authenticated user.</param>
/// <param name="Message">A generic instruction that discloses nothing about the squad or the invite.</param>
public sealed record InvitePreviewResponse(bool RequiresAuthentication, string Message);
