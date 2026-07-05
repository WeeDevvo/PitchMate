namespace PitchMate.Application.Auth.UseCases;

/// <summary>
/// A request to refresh a session by exchanging a rotating refresh token for a new
/// access token and a successor refresh token (Requirement 9.2). The
/// <paramref name="RefreshToken"/> is the opaque plaintext secret the client was handed at
/// issuance; it may be <see langword="null"/> or blank so a malformed presentation is
/// reported as an invalid-token failure rather than throwing.
/// </summary>
/// <param name="RefreshToken">The opaque plaintext refresh-token secret presented by the client.</param>
public sealed record RefreshSessionCommand(string? RefreshToken);
