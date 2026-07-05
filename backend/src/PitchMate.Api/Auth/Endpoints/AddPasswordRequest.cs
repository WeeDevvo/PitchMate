namespace PitchMate.Api.Auth.Endpoints;

/// <summary>
/// The request body for adding a Password sign-in method to the authenticated account that currently
/// owns none (Requirement 10.5). The owning user is resolved from the caller's access token, and the
/// new identity's provider user id is the user's own normalised email, so only the raw
/// <paramref name="Password"/> is accepted here.
/// </summary>
/// <param name="Password">The raw plaintext password; validated against the password-strength policy.</param>
public sealed record AddPasswordRequest(string? Password);
