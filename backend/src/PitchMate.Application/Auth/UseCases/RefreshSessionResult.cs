namespace PitchMate.Application.Auth.UseCases;

/// <summary>
/// The refreshed session: a newly issued access token and the successor refresh token,
/// each with its absolute expiry. The <paramref name="RefreshToken"/> plaintext is returned
/// to the client exactly once and is never stored — only its one-way hash is persisted in
/// the revocation store (Requirements 9.2, 9.6).
/// </summary>
/// <param name="AccessToken">The signed access-token string for the refreshed session.</param>
/// <param name="AccessTokenExpiresAt">The absolute instant at which the access token expires.</param>
/// <param name="RefreshToken">The opaque successor refresh-token secret, returned once.</param>
/// <param name="RefreshTokenExpiresAt">The absolute instant at which the successor refresh token expires.</param>
public sealed record RefreshSessionResult(
    string AccessToken,
    DateTimeOffset AccessTokenExpiresAt,
    string RefreshToken,
    DateTimeOffset RefreshTokenExpiresAt);
