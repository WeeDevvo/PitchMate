using PitchMate.Application.Auth.Abstractions;
using PitchMate.Domain.Auth;

namespace PitchMate.Application.Auth.UseCases;

/// <summary>
/// Reads the authenticated caller's own account for the account-settings surface: the caller's
/// profile plus one entry per linked sign-in method, each carrying the identity id that unlinking
/// targets (Requirements 8.2, 8.3, 8.4).
/// <para>
/// The handler reads through the existing <see cref="IUserRepository"/> and
/// <see cref="IAuthIdentityRepository"/> gateways and mutates no state (Requirement 8.9). It reads
/// the caller's own user and the caller's own identities only, so the view can never describe
/// another user. A request for a user that does not exist produces no view and returns a typed
/// <see cref="AuthErrorCode.UserNotFound"/> failure, which the Api translates through the existing
/// auth error mapping (Requirement 8.6).
/// </para>
/// <para>
/// Identities are ordered by their linked instant and then by their identity id as a stable
/// tie-break, so the same set of identities always yields the same order regardless of the order
/// the repository returns them in (Requirement 8.5). Nothing on the returned graph carries a
/// provider subject, a credential, or token material (Requirement 8.7), and the DSAR
/// <see cref="Gdpr.UserDataExport"/> is a separate read model that this use case does not touch
/// (Requirement 9.4).
/// </para>
/// </summary>
public sealed class GetAccountHandler
{
    private readonly IUserRepository _users;
    private readonly IAuthIdentityRepository _authIdentities;

    /// <summary>
    /// Creates the handler with the read-only user and auth-identity gateways it reads through.
    /// </summary>
    /// <param name="users">The gateway used to load the caller's user record.</param>
    /// <param name="authIdentities">The gateway used to list the caller's linked identities.</param>
    public GetAccountHandler(IUserRepository users, IAuthIdentityRepository authIdentities)
    {
        ArgumentNullException.ThrowIfNull(users);
        ArgumentNullException.ThrowIfNull(authIdentities);

        _users = users;
        _authIdentities = authIdentities;
    }

    /// <summary>
    /// Handles a <see cref="GetAccountCommand"/>, returning the caller's own
    /// <see cref="AccountView"/> or a typed failure when no such user exists.
    /// </summary>
    /// <param name="command">The read request carrying the authenticated caller's user identifier.</param>
    /// <param name="ct">A token to cancel the operation.</param>
    /// <returns>
    /// A <see cref="Result{T}"/> carrying the <see cref="AccountView"/> on success, or a failure
    /// carrying <see cref="AuthErrorCode.UserNotFound"/> when no such user exists.
    /// </returns>
    public async Task<Result<AccountView>> HandleAsync(GetAccountCommand command, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(command);

        User? user = await _users.GetByIdAsync(command.UserId, ct);
        if (user is null)
        {
            return Result<AccountView>.Fail(new AuthError(
                AuthErrorCode.UserNotFound,
                "No user exists for the supplied identifier."));
        }

        // Read the caller's own identities only, and disclose of each one just the id unlinking
        // targets, the provider kind, and when it was linked — never the provider subject or any
        // credential material.
        IReadOnlyList<AuthIdentity> identities = await _authIdentities.ListForUserAsync(user.Id, ct);

        // Deterministic order: linked instant first, then identity id as a stable tie-break, so
        // any permutation of the source list produces the same view.
        IReadOnlyList<LinkedIdentityView> linkedIdentities = identities
            .OrderBy(identity => identity.CreatedAt)
            .ThenBy(identity => identity.Id)
            .Select(identity => new LinkedIdentityView(identity.Id, identity.Provider, identity.CreatedAt))
            .ToList();

        var view = new AccountView(
            user.Id,
            user.DisplayName,
            user.Email,
            user.EmailVerified,
            user.AvatarReference,
            linkedIdentities);

        return Result<AccountView>.Ok(view);
    }
}
