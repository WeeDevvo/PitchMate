namespace PitchMate.Application.Auth.Abstractions;

/// <summary>
/// A generated refresh-token secret split into the <paramref name="Plaintext"/> handed to the client
/// exactly once and the one-way <paramref name="Hash"/> persisted server-side. The plaintext is never
/// stored, so a leaked store cannot reconstruct usable tokens (Requirement 9.6).
/// </summary>
/// <param name="Plaintext">The opaque secret returned to the client once.</param>
/// <param name="Hash">The one-way hash to persist for later fixed-time comparison.</param>
public sealed record RefreshTokenSecret(string Plaintext, string Hash);
