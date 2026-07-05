namespace PitchMate.Application.Auth.EmailVerification;

/// <summary>
/// A request to redeem an email-verification token. The <paramref name="Token"/> is the
/// opaque plaintext secret the user received by email; only its one-way hash is ever
/// compared against stored values.
/// </summary>
/// <param name="Token">The plaintext verification-token secret presented for redemption.</param>
public sealed record RedeemEmailVerificationCommand(string Token);
