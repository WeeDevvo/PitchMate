using PitchMate.Application.Auth.Abstractions;
using PitchMate.Application.Common.Persistence;
using PitchMate.Domain.Auth;

namespace PitchMate.Application.Auth.UseCases;

/// <summary>
/// Refreshes a session by rotating a refresh token (Requirement 9). The presented opaque
/// secret is matched by hashing it and looking it up in the revocation store; only hashes
/// are ever persisted (Requirement 9.6). The handler distinguishes four outcomes:
/// <list type="bullet">
///   <item>
///     <description>
///       <strong>Unknown</strong> — the hash matches no stored token: rejected as invalid,
///       no tokens issued, and every Token_Family left unchanged (Requirement 9.9).
///     </description>
///   </item>
///   <item>
///     <description>
///       <strong>Reuse</strong> — the matched token is already <see cref="RefreshTokenStatus.Rotated"/>
///       or <see cref="RefreshTokenStatus.Revoked"/>: every token in its family is revoked and the
///       refresh is rejected, so replay of a superseded token cuts off the whole session
///       (Requirement 9.3).
///     </description>
///   </item>
///   <item>
///     <description>
///       <strong>Expired</strong> — the matched token is active but its expiry is at or before the
///       Clock instant: rejected as expired with nothing issued (Requirement 9.5).
///     </description>
///   </item>
///   <item>
///     <description>
///       <strong>Valid</strong> — the matched token is active and unexpired: a new access token is
///       issued, a successor refresh token is created in the same family, the presented token is
///       marked rotated, and only the successor remains active (Requirements 9.2, 9.7).
///     </description>
///   </item>
/// </list>
/// All state changes are committed atomically through the unit of work.
/// </summary>
public sealed class RefreshSessionHandler(
    IRefreshTokenStore refreshTokens,
    IUserRepository users,
    ITokenService tokenService,
    ISecretHasher secretHasher,
    IUnitOfWork unitOfWork,
    TimeProvider clock)
{
    /// <summary>
    /// Handles a <see cref="RefreshSessionCommand"/>, returning the refreshed session on
    /// success or a typed <see cref="AuthError"/> that issues no tokens.
    /// </summary>
    /// <param name="command">The refresh request carrying the presented refresh-token secret.</param>
    /// <param name="ct">A token to cancel the operation.</param>
    /// <returns>
    /// <see cref="Result{T}.Ok"/> carrying the new access and successor refresh tokens on success;
    /// a failure carrying <see cref="AuthErrorCode.TokenInvalid"/> for an unknown token or detected
    /// reuse, or <see cref="AuthErrorCode.TokenExpired"/> for an expired token.
    /// </returns>
    public async Task<Result<RefreshSessionResult>> HandleAsync(
        RefreshSessionCommand command,
        CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(command);

        // An absent secret can match nothing; reject before hashing and leave families
        // unchanged (Requirement 9.9).
        if (string.IsNullOrWhiteSpace(command.RefreshToken))
        {
            return InvalidToken();
        }

        // Match by hashing the presented secret and looking up the stored row; only hashes
        // are persisted (Requirement 9.6).
        string presentedHash = secretHasher.Hash(command.RefreshToken);
        RefreshToken? token = await refreshTokens.FindByHashAsync(presentedHash, ct);

        // Unknown hash: reject as invalid, issue nothing, change no family (Requirement 9.9).
        if (token is null)
        {
            return InvalidToken();
        }

        DateTimeOffset now = clock.GetUtcNow();

        // Reuse of a superseded member: the token is recorded as rotated or revoked. Revoke
        // every token in its family so replay cuts off the whole session (Requirement 9.3).
        if (token.Status != RefreshTokenStatus.Active)
        {
            IReadOnlyList<RefreshToken> family = await refreshTokens.ListFamilyAsync(token.TokenFamilyId, ct);
            foreach (RefreshToken member in family)
            {
                member.Revoke();
            }

            await unitOfWork.SaveChangesAsync(ct);
            return InvalidToken();
        }

        // Active but past its expiry: reject as expired, issuing nothing and leaving the
        // family unchanged (Requirement 9.5).
        if (!token.IsActiveAt(now))
        {
            return Result<RefreshSessionResult>.Fail(new AuthError(
                AuthErrorCode.TokenExpired,
                "The refresh token has expired."));
        }

        // Resolve the owner before mutating anything, so a defensively unexpected missing
        // user leaves all state unchanged.
        User? user = await users.GetByIdAsync(token.UserId, ct);
        if (user is null)
        {
            return InvalidToken();
        }

        // Valid active token: mint a new access token and rotate to a successor in the same
        // family. The token service stamps the successor's expiry from its own clock plus the
        // configured refresh-token lifetime (Requirement 9.2). Rotate marks the presented token
        // rotated and returns the sole new active member, so the family keeps exactly one active
        // token (Requirements 9.2, 9.7).
        AccessTokenResult accessToken = tokenService.IssueAccessToken(user);
        RefreshTokenSecret successorSecret = tokenService.GenerateRefreshToken();

        RefreshToken successor = token.Rotate(successorSecret.Hash, successorSecret.ExpiresAt);
        await refreshTokens.AddAsync(successor, ct);

        await unitOfWork.SaveChangesAsync(ct);

        return Result<RefreshSessionResult>.Ok(new RefreshSessionResult(
            accessToken.Token,
            accessToken.ExpiresAt,
            successorSecret.Plaintext,
            successor.ExpiresAt));
    }

    private static Result<RefreshSessionResult> InvalidToken() =>
        Result<RefreshSessionResult>.Fail(new AuthError(
            AuthErrorCode.TokenInvalid,
            "The refresh token is invalid."));
}
