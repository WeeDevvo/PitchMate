using PitchMate.Application.Auth.Abstractions;
using PitchMate.Application.Common.Persistence;
using PitchMate.Domain.Auth;

namespace PitchMate.Application.Auth.UseCases;

/// <summary>
/// Signs out of a session by revoking its entire Token_Family (Requirement 9.4). The
/// presented refresh token is matched by hashing it and looking it up in the revocation
/// store; every token sharing its <see cref="RefreshToken.TokenFamilyId"/> is then marked
/// <see cref="RefreshTokenStatus.Revoked"/>, so no member — active, rotated, or already
/// revoked — can be used to refresh again. Already-issued access tokens are left to expire
/// on their own configured lifetime and are not extended (Requirement 9.8).
/// <para>
/// Sign-out is idempotent and reveals nothing: an absent secret or a hash matching no
/// stored token yields a successful result with no family to revoke, and re-signing out an
/// already-revoked family simply re-applies the terminal state.
/// </para>
/// </summary>
public sealed class SignOutHandler(
    IRefreshTokenStore refreshTokens,
    ISecretHasher secretHasher,
    IUnitOfWork unitOfWork)
{
    /// <summary>
    /// Handles a <see cref="SignOutCommand"/>, revoking every refresh token in the
    /// presented session's family and committing atomically.
    /// </summary>
    /// <param name="command">The sign-out request carrying a refresh token from the session to end.</param>
    /// <param name="ct">A token to cancel the operation.</param>
    /// <returns>A successful <see cref="Result"/>; sign-out never fails for an unknown or absent token.</returns>
    public async Task<Result> HandleAsync(SignOutCommand command, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(command);

        // No secret to match: there is no family to revoke, and the desired end state — no
        // refreshable session — already holds.
        if (string.IsNullOrWhiteSpace(command.RefreshToken))
        {
            return Result.Ok();
        }

        // Match by hashing the presented secret; only hashes are persisted (Requirement 9.6).
        string presentedHash = secretHasher.Hash(command.RefreshToken);
        RefreshToken? token = await refreshTokens.FindByHashAsync(presentedHash, ct);

        // Unknown token: nothing to revoke. Idempotent success that leaks no information.
        if (token is null)
        {
            return Result.Ok();
        }

        // Revoke every member of the session's family so none can refresh again
        // (Requirement 9.4).
        IReadOnlyList<RefreshToken> family = await refreshTokens.ListFamilyAsync(token.TokenFamilyId, ct);
        foreach (RefreshToken member in family)
        {
            member.Revoke();
        }

        await unitOfWork.SaveChangesAsync(ct);
        return Result.Ok();
    }
}
