using PitchMate.Application.Auth.Abstractions;
using PitchMate.Application.Common.Persistence;
using PitchMate.Domain.Auth;

namespace PitchMate.Application.Auth.PasswordReset;

/// <summary>
/// Begins a password reset for an email address. The flow is deliberately
/// <strong>uniform</strong>: whether or not the email resolves to a
/// <see cref="AuthProvider.Password"/> identity — and whether or not the request is
/// suppressed by the rolling-window rate limit — the caller always receives an identical
/// successful result that reveals nothing about account existence (Requirements 5.2, 5.8).
/// <para>
/// When a Password identity does exist and the rate limit permits, the handler supersedes
/// any prior unredeemed reset token for that identity, issues a fresh single-use token
/// whose expiry is the clock instant plus the configured lifetime (≤ 60 minutes), persists
/// only its one-way hash, and emails the plaintext secret. A delivery failure is swallowed
/// rather than surfaced, so it cannot become a side channel for account enumeration
/// (Requirements 5.1, 5.10).
/// </para>
/// </summary>
public sealed class RequestPasswordResetHandler(
    IAuthIdentityRepository authIdentities,
    IPasswordResetTokenRepository resetTokens,
    ISecretTokenGenerator tokenGenerator,
    ISecretHasher secretHasher,
    IEmailSender emailSender,
    IUnitOfWork unitOfWork,
    TimeProvider clock,
    PasswordResetOptions options)
{
    /// <summary>
    /// Handles a <see cref="RequestPasswordResetCommand"/>, always returning a successful,
    /// uniform <see cref="Result"/>. Any work (token issuance, persistence, email delivery)
    /// happens only when a matching Password identity exists and the rate limit permits, and
    /// is invisible in the returned result (Requirements 5.2, 5.8).
    /// </summary>
    /// <param name="command">The reset request carrying the raw email.</param>
    /// <param name="ct">A token to cancel the operation.</param>
    /// <returns>A uniform successful <see cref="Result"/>.</returns>
    public async Task<Result> HandleAsync(RequestPasswordResetCommand command, CancellationToken ct)
    {
        // A malformed email can never map to an account; treat it exactly like a
        // non-existent account so the response stays uniform (Requirement 5.2).
        // EmailAddress.Create returns the Domain Result<T>; capture with var to avoid
        // colliding with the Application-layer Result type used for the handler outcome.
        var email = EmailAddress.Create(command.Email);
        if (!email.IsSuccess)
        {
            return Result.Ok();
        }

        // Resolution is solely on (Password, normalisedEmail) — never on email matching
        // beyond the provider key (Requirements 1.4, 5.1).
        AuthIdentity? identity = await authIdentities.FindByProviderKeyAsync(
            AuthProvider.Password, email.Value!.Value, ct);

        // No Password identity: send nothing, persist nothing, and return the same result
        // a real account would yield (Requirement 5.2).
        if (identity is null)
        {
            return Result.Ok();
        }

        DateTimeOffset now = clock.GetUtcNow();

        // Rolling-window rate limit, applied behind the uniform response so it leaks no
        // account information (Requirement 5.8).
        int recentRequests = await resetTokens.CountRequestsInWindowAsync(
            identity.Id, now - options.RateLimitWindow, ct);
        if (recentRequests >= options.MaxRequestsPerWindow)
        {
            return Result.Ok();
        }

        // Supersede any prior unredeemed token so at most one is ever redeemable
        // (Requirement 5.10).
        IReadOnlyList<PasswordResetToken> priorTokens =
            await resetTokens.ListUnredeemedForAuthIdentityAsync(identity.Id, ct);
        foreach (PasswordResetToken prior in priorTokens)
        {
            prior.Invalidate();
        }

        // Issue a fresh single-use token; only the one-way hash is persisted, the plaintext
        // is emailed once (Requirements 5.1, 5.9).
        string plaintext = tokenGenerator.Generate();
        var token = PasswordResetToken.Issue(
            identity.Id,
            secretHasher.Hash(plaintext),
            now + options.TokenLifetime);

        await resetTokens.AddAsync(token, ct);
        await unitOfWork.SaveChangesAsync(ct);

        // Deliver the reset link. A delivery failure must not change the response, otherwise
        // it would reveal that the account exists (Requirement 5.2); the token simply goes
        // unused and the user can request another.
        var message = new EmailMessage(
            email.Value.Value,
            "Reset your PitchMate password",
            $"Use this code to reset your password: {plaintext}");
        await emailSender.SendAsync(message, ct);

        return Result.Ok();
    }
}
