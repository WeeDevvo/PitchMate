using PitchMate.Application.Auth.Abstractions;
using PitchMate.Application.Common.Persistence;
using PitchMate.Domain.Auth;

namespace PitchMate.Application.Auth.UseCases;

/// <summary>
/// Adds a Password sign-in method to an already-authenticated account that currently owns
/// none (Requirement 10). The account's normalised email becomes the new identity's
/// provider user id, and the supplied plaintext is stored only as a one-way salted hash
/// behind the new <see cref="PasswordCredential"/>.
/// <list type="bullet">
///   <item>A request without an authenticated session adds nothing and fails with
///   <see cref="AuthErrorCode.Unauthenticated"/>.</item>
///   <item>If the account already owns a Password identity, the request is rejected with
///   <see cref="AuthErrorCode.PasswordMethodExists"/>, creating no credential and leaving
///   the user's existing identities unchanged (Requirement 10.9).</item>
///   <item>If the supplied password fails the password-strength policy, the request is
///   rejected with <see cref="AuthErrorCode.PasswordPolicy"/>, creating no credential or
///   identity and leaving the user unchanged (Requirement 10.10).</item>
///   <item>Otherwise a Password <see cref="AuthIdentity"/> and its
///   <see cref="PasswordCredential"/> are created for the user (Requirement 10.5).</item>
/// </list>
/// </summary>
public sealed class AddPasswordCredentialHandler
{
    private readonly IUserRepository _users;
    private readonly IAuthIdentityRepository _identities;
    private readonly IPasswordHasher _passwordHasher;
    private readonly IUnitOfWork _unitOfWork;

    /// <summary>
    /// Creates the handler with the repositories, password hasher, and unit of work it
    /// commits through.
    /// </summary>
    public AddPasswordCredentialHandler(
        IUserRepository users,
        IAuthIdentityRepository identities,
        IPasswordHasher passwordHasher,
        IUnitOfWork unitOfWork)
    {
        ArgumentNullException.ThrowIfNull(users);
        ArgumentNullException.ThrowIfNull(identities);
        ArgumentNullException.ThrowIfNull(passwordHasher);
        ArgumentNullException.ThrowIfNull(unitOfWork);

        _users = users;
        _identities = identities;
        _passwordHasher = passwordHasher;
        _unitOfWork = unitOfWork;
    }

    /// <summary>
    /// Handles an <see cref="AddPasswordCredentialCommand"/>, returning the new identity's
    /// details on success or a typed <see cref="AuthError"/> on a missing session, an
    /// existing Password method, or a policy-violating password.
    /// </summary>
    /// <param name="command">The add-password request carrying the authenticated user and password.</param>
    /// <param name="ct">A token to cancel the operation.</param>
    public async Task<Result<AddPasswordCredentialResult>> HandleAsync(
        AddPasswordCredentialCommand command,
        CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(command);

        // The request must carry a valid authenticated session.
        if (command.UserId is not { } userId || userId == Guid.Empty)
        {
            return Unauthenticated();
        }

        // The requesting principal must exist for the session to be valid.
        User? user = await _users.GetByIdAsync(userId, ct);
        if (user is null)
        {
            return Unauthenticated();
        }

        // Reject a second Password method: at most one Password identity per user
        // (Requirement 10.9). Existing identities are left unchanged.
        IReadOnlyList<AuthIdentity> existing = await _identities.ListForUserAsync(userId, ct);
        if (existing.Any(identity => identity.Provider == AuthProvider.Password))
        {
            return Fail(
                AuthErrorCode.PasswordMethodExists,
                "A Password sign-in method already exists for the account.");
        }

        // Enforce the password-strength policy (Requirement 10.10). A policy-violating password
        // creates no credential or identity and leaves the user unchanged.
        if (!PasswordPolicy.IsAcceptable(command.Password))
        {
            return Fail(
                AuthErrorCode.PasswordPolicy,
                $"The password must be between {PasswordPolicy.MinLength} and {PasswordPolicy.MaxLength} characters.");
        }

        // Build the Password identity keyed on the user's own normalised email, storing only a
        // one-way salted hash (Requirement 10.5). The user's email is already normalised.
        string passwordHash = _passwordHasher.Hash(command.Password!);
        PasswordCredential credential = PasswordCredential.Create(passwordHash);
        AuthIdentity identity = AuthIdentity.ForPassword(user.Id, user.Email, credential);

        await _identities.AddAsync(identity, ct);

        try
        {
            await _unitOfWork.SaveChangesAsync(ct);
        }
        catch (DuplicateKeyException)
        {
            // A concurrent add won the race on the unique (Provider, ProviderUserId) index, or the
            // email is already a Password identity. Nothing from this operation was persisted
            // (Requirement 10.9).
            return Fail(
                AuthErrorCode.PasswordMethodExists,
                "A Password sign-in method already exists for the account.");
        }

        return Result<AddPasswordCredentialResult>.Ok(
            new AddPasswordCredentialResult(user.Id, identity.Id));
    }

    private static Result<AddPasswordCredentialResult> Unauthenticated() =>
        Fail(AuthErrorCode.Unauthenticated, "Adding a password requires an authenticated session.");

    private static Result<AddPasswordCredentialResult> Fail(AuthErrorCode code, string message) =>
        Result<AddPasswordCredentialResult>.Fail(new AuthError(code, message));
}
