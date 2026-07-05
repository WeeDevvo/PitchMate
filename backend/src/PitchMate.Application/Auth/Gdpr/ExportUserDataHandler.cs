using PitchMate.Application.Auth.Abstractions;
using PitchMate.Domain.Auth;

namespace PitchMate.Application.Auth.Gdpr;

/// <summary>
/// Produces the data-subject export (DSAR) record for an existing user (Requirements 14.4,
/// 14.8). The export contains exactly the user's display name, email address, email
/// verification state, and the <see cref="AuthProvider"/> of each owned
/// <see cref="AuthIdentity"/>, and deliberately excludes every secret: password hashes,
/// refresh-token hashes, stored verification/reset token hashes, and provider subjects.
/// <para>
/// The handler reads only; it mutates no state. A request for a user that does not exist
/// produces no record and returns a typed <see cref="AuthErrorCode.UserNotFound"/> failure
/// (Requirement 14.8).
/// </para>
/// </summary>
public sealed class ExportUserDataHandler(
    IUserRepository users,
    IAuthIdentityRepository authIdentities)
{
    /// <summary>
    /// Handles an <see cref="ExportUserDataCommand"/>, returning the export record for the
    /// user or a typed failure when no such user exists.
    /// </summary>
    /// <param name="command">The export request identifying the user.</param>
    /// <param name="ct">A token to cancel the operation.</param>
    /// <returns>
    /// A <see cref="Result{T}"/> carrying the <see cref="UserDataExport"/> on success, or a
    /// failure carrying <see cref="AuthErrorCode.UserNotFound"/> when no such user exists.
    /// </returns>
    public async Task<Result<UserDataExport>> HandleAsync(ExportUserDataCommand command, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(command);

        User? user = await users.GetByIdAsync(command.UserId, ct);
        if (user is null)
        {
            return Result<UserDataExport>.Fail(new AuthError(
                AuthErrorCode.UserNotFound,
                "No user exists for the supplied identifier."));
        }

        // Disclose only the provider kind of each owned identity — never the provider subject
        // or any secret material (Requirement 14.4).
        IReadOnlyList<AuthIdentity> identities = await authIdentities.ListForUserAsync(command.UserId, ct);
        IReadOnlyList<AuthProvider> providers = identities
            .Select(identity => identity.Provider)
            .ToList();

        var export = new UserDataExport(
            user.DisplayName,
            user.Email,
            user.EmailVerified,
            providers);

        return Result<UserDataExport>.Ok(export);
    }
}
