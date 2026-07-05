using PitchMate.Application.Auth.Abstractions;
using PitchMate.Application.Common.Persistence;
using PitchMate.Domain.Auth;

namespace PitchMate.Application.Auth.Gdpr;

/// <summary>
/// Erases a user under the GDPR right to erasure by anonymising their identity rather than
/// hard-deleting them, so immutable matches and rating replay stay valid (Requirement 14).
/// As a single atomic unit of work the handler:
/// <list type="bullet">
///   <item>strips the <see cref="User"/>'s PII through the persistence-foundation
///   <see cref="Domain.Common.IAnonymisable"/> hook (<see cref="User.Anonymise"/>), so the
///   de-identified row and its relationships remain present (Requirements 14.1, 14.6);</item>
///   <item>removes every <see cref="PasswordCredential"/> of the user so no subsequent
///   credential check can succeed (Requirement 14.2);</item>
///   <item>revokes every active <see cref="RefreshToken"/> in the revocation store so no
///   refresh-token presentation can succeed (Requirement 14.2);</item>
///   <item>scrubs each external <see cref="AuthIdentity"/>'s
///   <see cref="AuthIdentity.ProviderUserId"/> via <see cref="AuthIdentity.Anonymise"/> so
///   no retained value identifies the person and no incoming assertion can resolve to the
///   user (Requirement 14.3).</item>
/// </list>
/// <para>
/// Every mutation is staged and committed in one <see cref="IUnitOfWork.SaveChangesAsync"/>,
/// so a failure persists nothing and leaves the pre-erasure state intact (Requirement 14.7).
/// The operation is idempotent: re-running it on an already-anonymised user re-applies the
/// same deterministic placeholders, finds no live credentials and no active tokens, and
/// completes without error (Requirement 14.5). An unknown user is a typed failure
/// (Requirement 14.8 mirror for erasure).
/// </para>
/// </summary>
public sealed class EraseUserHandler(
    IUserRepository users,
    IAuthIdentityRepository authIdentities,
    IRepository<PasswordCredential> passwordCredentials,
    IRefreshTokenStore refreshTokens,
    IUnitOfWork unitOfWork)
{
    /// <summary>
    /// Handles an <see cref="EraseUserCommand"/>, anonymising the user and destroying every
    /// means of signing in as them, atomically.
    /// </summary>
    /// <param name="command">The erasure request identifying the user.</param>
    /// <param name="ct">A token to cancel the operation.</param>
    /// <returns>
    /// <see cref="Result.Ok"/> once erasure has committed; a failure carrying
    /// <see cref="AuthErrorCode.UserNotFound"/> when no such user exists.
    /// </returns>
    public async Task<Result> HandleAsync(EraseUserCommand command, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(command);

        // Resolve the target user; an unknown user is a typed failure that changes nothing
        // (Requirement 14.8 mirror).
        User? user = await users.GetByIdAsync(command.UserId, ct);
        if (user is null)
        {
            return Result.Fail(new AuthError(
                AuthErrorCode.UserNotFound,
                "No user exists for the supplied identifier."));
        }

        // Strip the user's PII through the anonymisation hook. The Id and relationships are
        // left unchanged and the call is idempotent (Requirements 14.1, 14.5, 14.6).
        user.Anonymise();

        // Walk the user's identities: remove the credential behind every Password identity so
        // no credential check can succeed, and scrub every external identity's provider key so
        // no retained value identifies the person or resolves a sign-in (Requirements 14.2, 14.3).
        IReadOnlyList<AuthIdentity> identities = await authIdentities.ListForUserAsync(command.UserId, ct);
        foreach (AuthIdentity identity in identities)
        {
            if (identity.Provider == AuthProvider.Password)
            {
                // The credential navigation is null once it has already been removed, so a
                // repeated erasure simply finds nothing to remove (Requirement 14.5).
                if (identity.Credential is not null)
                {
                    passwordCredentials.Remove(identity.Credential);
                }
            }
            else
            {
                // Deterministic placeholder derived from the row Id; idempotent (Requirement 14.5).
                identity.Anonymise();
            }
        }

        // Revoke every active refresh token so no session can be refreshed after erasure
        // (Requirement 14.2). Rotated and already-revoked tokens cannot refresh regardless.
        IReadOnlyList<RefreshToken> activeTokens = await refreshTokens.ListActiveForUserAsync(command.UserId, ct);
        foreach (RefreshToken token in activeTokens)
        {
            token.Revoke();
        }

        // Commit every change atomically; on failure nothing is persisted and the pre-erasure
        // state remains (Requirement 14.7).
        await unitOfWork.SaveChangesAsync(ct);

        return Result.Ok();
    }
}
