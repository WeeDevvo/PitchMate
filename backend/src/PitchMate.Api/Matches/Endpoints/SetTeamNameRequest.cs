namespace PitchMate.Api.Matches.Endpoints;

/// <summary>
/// The body of a set-team-name team adjustment (Requirement 8.3, 8.4). When
/// <paramref name="TeamName"/> is <see langword="null"/> or blank the admin has supplied none, so a
/// name is drawn from the silly-name generator; length and uniqueness are validated at lock. The
/// acting admin is resolved from the access token, never from the body.
/// </summary>
/// <param name="TeamName">The requested team name, or <see langword="null"/>/blank to generate one.</param>
public sealed record SetTeamNameRequest(string? TeamName);
