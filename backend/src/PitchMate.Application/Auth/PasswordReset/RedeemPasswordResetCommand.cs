namespace PitchMate.Application.Auth.PasswordReset;

/// <summary>
/// A request to complete a password reset by presenting the single-use reset
/// <paramref name="Token"/> secret delivered by email together with a
/// <paramref name="NewPassword"/> to set. On success the stored password hash is
/// replaced, the token is marked redeemed, and every refresh token of the affected user
/// is revoked (Requirements 5.3, 5.4).
/// </summary>
/// <param name="Token">The plaintext reset-token secret presented for redemption.</param>
/// <param name="NewPassword">The new plaintext password to set; must meet the password-strength policy.</param>
public sealed record RedeemPasswordResetCommand(string Token, string NewPassword);
