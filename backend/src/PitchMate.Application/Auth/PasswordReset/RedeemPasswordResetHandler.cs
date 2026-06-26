using PitchMate.Application.Auth.Abstractions;
using PitchMate.Application.Common.Persistence;
using PitchMate.Domain.Auth;

namespace PitchMate.Application.Auth.PasswordReset;

/// <summary>
/// Completes a password reset by redeeming a single-use reset token and setting a new
/// password. On success the handler, as one atomic unit of work, replaces the stored
/// password hash with a hash of the new password, marks the token redeemed, and revokes
/// every active refresh token of the affected user so sessions established before the
/// reset can no longer be refreshed (Requirements 5.3, 5.4).
/// <para>
/// Every validation is performed <strong>before</strong> any state is mutated, so a
/// rejected redemption — an unknown, expired, or already-redeemed token, or a new password
/// that fails the strength policy — leaves the existing hash and the token's unredeemed
/// state completely unchanged and establishes no session (Requirements 5.5, 5.6, 5.7).
/// </para>
/// </summary>
public sealed class RedeemPasswordResetHandler(
    IPasswordResetTokenRepository resetTokens,
    IAuthIdentityRepository authIdentities,
    IRepository<AuthIdentity> authIdentityById,
    IRefreshTokenStore refreshTokens,
    IPasswordHasher passwordHasher,
    ISecretHasher secretHasher,
    IUnitOfWork unitOfWork,
    TimeProvider clock)
{
    /// <summary>
    /// Handles a <see cref="RedeemPasswordResetCommand"/>, returning success once the new
    /// password has been stored, the token redeemed, and the user's refresh tokens revoked,
    /// or a typed failure that leaves all state unchanged.
    /// </summary>
    /// <param name="command">The redemption carrying the reset token and the new password.</param>
    /// <param name="ct">A token to cancel the operation.</param>
    /// <returns>
    /// <see cref="Result.Ok"/> on success; a failure carrying
    /// <see cref="AuthErrorCode.TokenInvalid"/> for an unknown/expired/redeemed token or
    /// <see cref="AuthErrorCode.PasswordPolicy"/> for a policy-violating new password.
    /// </returns>
    public async Task<Result> HandleAsync(RedeemPasswordResetCommand command, CancellationToken ct)
    {
        // An absent token can match nothing; reject before hashing (Requirement 5.6).
        if (string.IsNullOrWhiteSpace(command.Token))
        {
            return InvalidToken();
        }

        // Match by hashing the presented secret and looking up a currently redeemable row.
        // A null result covers the unknown, expired, and already-redeemed cases alike, all of
        // which surface as "invalid or expired" (Requirements 5.5, 5.6, 5.9).
        string presentedHash = secretHasher.Hash(command.Token);
        PasswordResetToken? token = await resetTokens.FindRedeemableByHashAsync(presentedHash, ct);
        if (token is null)
        {
            return InvalidToken();
        }

        DateTimeOffset now = clock.GetUtcNow();

        // Defence in depth against any clock drift between the lookup and here: re-judge
        // redeemability against the injected clock (Requirement 5.5).
        if (!token.IsRedeemableAt(now))
        {
            return InvalidToken();
        }

        // Reject a policy-violating password before touching any state, leaving the existing
        // hash and the token's unredeemed state unchanged (Requirement 5.7).
        if (!PasswordPolicy.IsAcceptable(command.NewPassword))
        {
            return Result.Fail(new AuthError(
                AuthErrorCode.PasswordPolicy,
                $"The new password must be {PasswordPolicy.MinLength}\u2013{PasswordPolicy.MaxLength} characters."));
        }

        // Resolve the owning user from the Password identity the token targets.
        AuthIdentity? identity = await authIdentityById.GetByIdAsync(token.AuthIdentityId, ct);
        if (identity is null)
        {
            return InvalidToken();
        }

        // Re-load the identity with its credential eager-loaded (ListForUserAsync includes the
        // credential) so the stored hash can be replaced on the tracked entity.
        IReadOnlyList<AuthIdentity> owned = await authIdentities.ListForUserAsync(identity.UserId, ct);
        PasswordCredential? credential = owned
            .FirstOrDefault(i => i.Id == token.AuthIdentityId)?
            .Credential;
        if (credential is null)
        {
            return InvalidToken();
        }

        // All validation passed — mutate state and commit atomically.
        credential.ReplaceHash(passwordHasher.Hash(command.NewPassword));
        token.Redeem(now);

        // Revoke every active refresh token so pre-reset sessions cannot be refreshed
        // (Requirement 5.4). Already-issued access tokens expire on their own lifetime.
        IReadOnlyList<RefreshToken> activeTokens =
            await refreshTokens.ListActiveForUserAsync(identity.UserId, ct);
        foreach (RefreshToken activeToken in activeTokens)
        {
            activeToken.Revoke();
        }

        await unitOfWork.SaveChangesAsync(ct);

        return Result.Ok();
    }

    private static Result InvalidToken() => Result.Fail(new AuthError(
        AuthErrorCode.TokenInvalid,
        "The password-reset token is invalid or has expired."));
}
