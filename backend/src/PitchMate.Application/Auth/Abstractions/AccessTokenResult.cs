namespace PitchMate.Application.Auth.Abstractions;

/// <summary>
/// A freshly issued access token: the signed <paramref name="Token"/> string and its absolute
/// <paramref name="ExpiresAt"/> instant, so callers can surface expiry without re-parsing the token.
/// </summary>
/// <param name="Token">The signed access-token string.</param>
/// <param name="ExpiresAt">The absolute instant at which the token expires.</param>
public sealed record AccessTokenResult(string Token, DateTimeOffset ExpiresAt);
