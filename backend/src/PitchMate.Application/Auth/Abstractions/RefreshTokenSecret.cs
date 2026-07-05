namespace PitchMate.Application.Auth.Abstractions;

/// <summary>
/// A generated refresh-token secret split into the <paramref name="Plaintext"/> handed to the client
/// exactly once and the one-way <paramref name="Hash"/> persisted server-side. The plaintext is never
/// stored, so a leaked store cannot reconstruct usable tokens (Requirement 9.6). The
/// <paramref name="ExpiresAt"/> instant is computed by the token service from its injected clock plus
/// the configured refresh-token lifetime, so callers persisting the token need no clock or lifetime of
/// their own — mirroring how <see cref="AccessTokenResult"/> carries its own expiry (Requirement 9.1).
/// </summary>
/// <param name="Plaintext">The opaque secret returned to the client once.</param>
/// <param name="Hash">The one-way hash to persist for later fixed-time comparison.</param>
/// <param name="ExpiresAt">The absolute instant after which the refresh token is no longer valid.</param>
public sealed record RefreshTokenSecret(string Plaintext, string Hash, DateTimeOffset ExpiresAt);
