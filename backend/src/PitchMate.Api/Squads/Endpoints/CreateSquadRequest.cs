namespace PitchMate.Api.Squads.Endpoints;

/// <summary>
/// The body of a create-squad request (Requirement 1). The <paramref name="Name"/> is trimmed and
/// validated (1..80 characters) by the handler; the optional <paramref name="DisplayName"/> is the
/// owner's squad-facing name, derived from the creating user's identity display name when omitted.
/// The creating user is resolved from the access token, never from the body.
/// </summary>
/// <param name="Name">The requested squad name.</param>
/// <param name="DisplayName">The owner's optional display name, or <see langword="null"/> to derive it.</param>
public sealed record CreateSquadRequest(string? Name, string? DisplayName);
