namespace PitchMate.Application.Squads.Abstractions;

/// <summary>
/// A freshly issued claim-link secret: the link handed to the admin once, and the one-way hash that is
/// the only form of the secret ever persisted.
/// </summary>
/// <param name="RedeemableLink">The full link a player opens to accept the claim.</param>
/// <param name="TokenHash">The one-way hash of the secret the link carries.</param>
public sealed record ClaimSecret(string RedeemableLink, string TokenHash);
