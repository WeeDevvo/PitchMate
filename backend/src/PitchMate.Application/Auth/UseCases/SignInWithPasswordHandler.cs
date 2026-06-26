using PitchMate.Application.Auth.Abstractions;
using PitchMate.Application.Common.Persistence;
using PitchMate.Domain.Auth;

namespace PitchMate.Application.Auth.UseCases;

/// <summary>
/// Signs a user in with an email address and password (Requirement 6). The handler is
/// written so that what an outsider can observe never reveals whether an email is
/// registered:
/// <list type="bullet">
///   <item>
///     <description>
///       <strong>Malformed input</strong> — a missing/invalid email or an empty password is a
///       <em>distinct</em> input-validation failure that performs no password-hash
///       verification at all (Requirement 6.3).
///     </description>
///   </item>
///   <item>
///     <description>
///       <strong>Fixed-time verification</strong> — when no Password identity exists the handler
///       still verifies the supplied password against a well-formed dummy hash, so a
///       non-existent account costs the same work as a real one (Requirement 6.6).
///     </description>
///   </item>
///   <item>
///     <description>
///       <strong>Generic failure</strong> — "no such identity" and "wrong password" both return one
///       indistinguishable authentication-failure result that issues no tokens and persists no
///       refresh-token hash (Requirement 6.2).
///     </description>
///   </item>
/// </list>
/// Resolution is solely on the pair (<see cref="AuthProvider.Password"/>, normalised email);
/// email is never used as a matching key beyond that provider id (Requirement 1.4). On success
/// the handler issues an access token and starts a new refresh-token family, persisting only the
/// refresh-token hash, and commits atomically (Requirements 6.1, 6.5, 9.1). The established
/// <see cref="AuthSession"/> shape is shared with Google sign-in.
/// <para>
/// Two optional gates are off by default (<see cref="SignInProtectionOptions"/>): a verified-email
/// requirement checked only <em>after</em> a correct password — so it cannot probe which addresses
/// exist — returning a distinct result (Requirement 6.4); and a temporary failed-attempt lockout
/// that, while engaged, refuses further attempts with the same generic result and issues nothing
/// (Requirement 6.7).
/// </para>
/// </summary>
public sealed class SignInWithPasswordHandler(
    IAuthIdentityRepository identities,
    IUserRepository users,
    IPasswordHasher passwordHasher,
    ITokenService tokenService,
    IRefreshTokenStore refreshTokens,
    ISignInAttemptTracker attemptTracker,
    IUnitOfWork unitOfWork,
    TimeProvider clock,
    SignInProtectionOptions protection)
{
    // A fixed, well-formed plaintext from which a dummy hash is derived so that a sign-in
    // against a non-existent identity performs the same verification work as one against a
    // real credential, keeping response timing from revealing whether an email is registered
    // (Requirement 6.6). The hash is computed lazily on first use — never in the constructor
    // and never on the malformed-input path — so a validation failure performs no hashing
    // (Requirement 6.3).
    private const string DummyPassword = "fixed-time-dummy-credential";

    private readonly Lazy<string> _dummyHash = new(() => passwordHasher.Hash(DummyPassword));

    /// <summary>
    /// Handles a <see cref="SignInWithPasswordCommand"/>, returning the established
    /// <see cref="AuthSession"/> on success or a typed <see cref="AuthError"/> that issues nothing.
    /// </summary>
    /// <param name="command">The sign-in request carrying the raw email and password.</param>
    /// <param name="ct">A token to cancel the operation.</param>
    /// <returns>
    /// <see cref="Result{T}.Ok"/> carrying the session on success; a failure carrying
    /// <see cref="AuthErrorCode.ValidationFailed"/> for malformed input,
    /// <see cref="AuthErrorCode.EmailNotVerified"/> when the verified-email gate blocks an
    /// otherwise-correct sign-in, or the generic <see cref="AuthErrorCode.AuthenticationFailed"/>
    /// for every other failure.
    /// </returns>
    public async Task<Result<AuthSession>> HandleAsync(
        SignInWithPasswordCommand command,
        CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(command);

        // (6.3) Validate input first. A missing/malformed email or an empty password is a
        // distinct validation failure and skips password-hash verification entirely. Capture
        // the Domain Result with var so it does not clash with the Application Result type.
        var email = EmailAddress.Create(command.Email);
        if (!email.IsSuccess || string.IsNullOrEmpty(command.Password))
        {
            return Result<AuthSession>.Fail(new AuthError(
                AuthErrorCode.ValidationFailed,
                "A valid email address and a non-empty password are required."));
        }

        string normalisedEmail = email.Value!.Value;
        DateTimeOffset now = clock.GetUtcNow();

        // (6.7) Optional lockout: while engaged, refuse further attempts with the generic
        // failure and issue nothing. Evaluated before any verification.
        if (protection.LockoutEnabled)
        {
            int recentFailures = await attemptTracker.CountFailedAttemptsAsync(
                normalisedEmail, now - protection.LockoutWindow, ct);
            if (recentFailures >= protection.MaxFailedAttempts)
            {
                return AuthenticationFailed();
            }
        }

        // Resolution is solely on (Password, normalisedEmail); the credential is eager-loaded
        // by the repository (Requirements 1.4, 1.11).
        AuthIdentity? identity = await identities.FindByProviderKeyAsync(
            AuthProvider.Password, normalisedEmail, ct);

        // (6.6) Always perform a fixed-time verification — against the real hash when the
        // identity exists, otherwise against a dummy hash — so the two failure paths converge
        // on one generic result with comparable timing (Requirement 6.2).
        string storedHash = identity?.Credential?.PasswordHash ?? _dummyHash.Value;
        PasswordVerification verification = passwordHasher.Verify(storedHash, command.Password);

        if (identity?.Credential is null || verification == PasswordVerification.Failure)
        {
            // (6.7) Account the failure for lockout when enabled; nothing else is persisted
            // and no refresh-token hash is written (Requirement 6.2).
            if (protection.LockoutEnabled)
            {
                await attemptTracker.RecordFailedAttemptAsync(normalisedEmail, now, ct);
            }

            return AuthenticationFailed();
        }

        // The password is correct. Resolve the owning user to issue the session.
        User? user = await users.GetByIdAsync(identity.UserId, ct);
        if (user is null)
        {
            // Defensive: an identity with no resolvable owner cannot establish a session.
            return AuthenticationFailed();
        }

        // (6.4) Optional verified-email gate, checked only after a correct password so it
        // cannot be used to probe which addresses are registered. Returns a distinct result.
        if (protection.RequireVerifiedEmail && !user.EmailVerified)
        {
            return Result<AuthSession>.Fail(new AuthError(
                AuthErrorCode.EmailNotVerified,
                "The email address must be verified before signing in."));
        }

        // (6.1, 6.5, 9.1) Establish the session: issue an access token and start a fresh
        // refresh-token family, persisting only the refresh-token hash. The token service
        // stamps the refresh token's expiry; the plaintext is returned to the caller once.
        AccessTokenResult accessToken = tokenService.IssueAccessToken(user);
        RefreshTokenSecret refreshSecret = tokenService.GenerateRefreshToken();

        RefreshToken refreshToken = RefreshToken.StartFamily(user.Id, refreshSecret.Hash, refreshSecret.ExpiresAt);
        await refreshTokens.AddAsync(refreshToken, ct);

        // (6.7) A successful sign-in clears the address's failure count.
        if (protection.LockoutEnabled)
        {
            await attemptTracker.ClearFailedAttemptsAsync(normalisedEmail, ct);
        }

        await unitOfWork.SaveChangesAsync(ct);

        return Result<AuthSession>.Ok(new AuthSession(
            user.Id,
            accessToken.Token,
            accessToken.ExpiresAt,
            refreshSecret.Plaintext,
            refreshToken.ExpiresAt));
    }

    private static Result<AuthSession> AuthenticationFailed() =>
        Result<AuthSession>.Fail(new AuthError(
            AuthErrorCode.AuthenticationFailed,
            "The email address or password is incorrect."));
}
