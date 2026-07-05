namespace PitchMate.Application.Auth.UseCases;

/// <summary>
/// The authenticated context established by a successful sign-in (Requirement 7.4, 7.5): the signed
/// access token and its expiry, the one-time refresh-token plaintext (the head of a freshly started
/// token family) and its expiry, and the identifier of the <c>User</c> the session belongs to.
/// <para>
/// Only the refresh token's one-way hash is persisted server-side; the <see cref="RefreshToken"/>
/// plaintext here is returned to the caller exactly once and never stored (Requirement 9.6). This
/// shape is shared by every handler that establishes a session (password sign-in, Google sign-in)
/// so the session contract is defined once.
/// </para>
/// </summary>
/// <param name="UserId">The identifier of the user the session authenticates.</param>
/// <param name="AccessToken">The signed, short-lived access token.</param>
/// <param name="AccessTokenExpiresAt">The absolute instant at which the access token expires.</param>
/// <param name="RefreshToken">The opaque refresh-token secret, returned to the client exactly once.</param>
/// <param name="RefreshTokenExpiresAt">The absolute instant at which the refresh token expires.</param>
public sealed record AuthSession(
    Guid UserId,
    string AccessToken,
    DateTimeOffset AccessTokenExpiresAt,
    string RefreshToken,
    DateTimeOffset RefreshTokenExpiresAt);
