namespace PitchMate.Api.Squads.Endpoints;

/// <summary>
/// The body of the claim-link preview and accept requests: the secret from the link's path. Sent in a
/// POST body so it never appears in a query string or a request log.
/// </summary>
/// <param name="PresentedSecret">The secret a player's client took from the claim link.</param>
public sealed record GuestClaimSecretRequest(string PresentedSecret);
