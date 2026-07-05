using PitchMate.Application.Auth.Abstractions;
using PitchMate.Application.Common.Persistence;
using PitchMate.Domain.Auth;

namespace PitchMate.Application.Auth.UseCases;

/// <summary>
/// Registers a new account from an email address and password (Requirement 2). The
/// handler validates and normalises the email, enforces the password-strength policy,
/// rejects a duplicate normalised email, and — as a single atomic unit of work — creates
/// the <see cref="User"/> (with its email recorded as not yet verified), a Password
/// <see cref="AuthIdentity"/> whose <see cref="AuthIdentity.ProviderUserId"/> is the
/// normalised email, and the <see cref="PasswordCredential"/> holding only a one-way
/// password hash. On success it initiates email verification through the
/// <see cref="IEmailVerificationInitiator"/> seam (Requirement 2.6).
/// <para>
/// If any step of the account-creation save fails, nothing is persisted; a unique-index
/// collision on <c>(Provider, ProviderUserId)</c> raised concurrently surfaces as a
/// duplicate-email rejection that leaves existing records unchanged (Requirements 2.1, 2.3).
/// </para>
/// </summary>
public sealed class RegisterWithPasswordHandler
{
    private readonly IUserRepository _users;
    private readonly IAuthIdentityRepository _identities;
    private readonly IPasswordHasher _passwordHasher;
    private readonly IEmailVerificationInitiator _emailVerification;
    private readonly IUnitOfWork _unitOfWork;

    /// <summary>
    /// Creates the handler with the repositories, password hasher, email-verification
    /// initiation seam, and unit of work it commits through.
    /// </summary>
    public RegisterWithPasswordHandler(
        IUserRepository users,
        IAuthIdentityRepository identities,
        IPasswordHasher passwordHasher,
        IEmailVerificationInitiator emailVerification,
        IUnitOfWork unitOfWork)
    {
        ArgumentNullException.ThrowIfNull(users);
        ArgumentNullException.ThrowIfNull(identities);
        ArgumentNullException.ThrowIfNull(passwordHasher);
        ArgumentNullException.ThrowIfNull(emailVerification);
        ArgumentNullException.ThrowIfNull(unitOfWork);

        _users = users;
        _identities = identities;
        _passwordHasher = passwordHasher;
        _emailVerification = emailVerification;
        _unitOfWork = unitOfWork;
    }

    /// <summary>
    /// Handles a <see cref="RegisterWithPasswordCommand"/>, returning the new user's
    /// identifier on success or a typed <see cref="AuthError"/> on validation failure or
    /// duplicate email.
    /// </summary>
    /// <param name="command">The registration request.</param>
    /// <param name="ct">A token to cancel the operation.</param>
    public async Task<Result<RegisterWithPasswordResult>> HandleAsync(
        RegisterWithPasswordCommand command,
        CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(command);

        // Validate + normalise the email (Requirements 2.5, 2.7).
        Domain.Rating.Result<EmailAddress> emailResult = EmailAddress.Create(command.Email);
        if (!emailResult.IsSuccess)
        {
            return Fail(AuthErrorCode.InvalidEmail, "The supplied email address is not valid.");
        }

        string normalisedEmail = emailResult.Value!.Value;

        // Enforce the password-strength policy (Requirement 2.4).
        if (!PasswordPolicy.IsAcceptable(command.Password))
        {
            return Fail(
                AuthErrorCode.PasswordPolicy,
                $"The password must be between {PasswordPolicy.MinLength} and {PasswordPolicy.MaxLength} characters.");
        }

        // Reject a duplicate normalised email, matched solely on the provider key
        // (Provider, ProviderUserId) (Requirement 2.3). Existing records are left untouched.
        AuthIdentity? existing =
            await _identities.FindByProviderKeyAsync(AuthProvider.Password, normalisedEmail, ct);
        if (existing is not null)
        {
            return Fail(AuthErrorCode.EmailAlreadyRegistered, "The email address is already registered.");
        }

        // Build the account graph. The password is stored only as a one-way salted hash
        // (Requirement 2.2); the plaintext is never persisted.
        string displayName = ResolveDisplayName(command.DisplayName, normalisedEmail);
        string passwordHash = _passwordHasher.Hash(command.Password!);

        User user = User.Create(displayName, normalisedEmail, emailVerified: false);
        PasswordCredential credential = PasswordCredential.Create(passwordHash);
        AuthIdentity identity = AuthIdentity.ForPassword(user.Id, normalisedEmail, credential);

        await _users.AddAsync(user, ct);
        await _identities.AddAsync(identity, ct);

        // Persist User + AuthIdentity + PasswordCredential atomically (Requirement 2.1).
        try
        {
            await _unitOfWork.SaveChangesAsync(ct);
        }
        catch (DuplicateKeyException)
        {
            // A concurrent registration won the race on the unique (Provider, ProviderUserId)
            // index. Nothing from this operation was persisted (Requirements 2.1, 2.3).
            return Fail(AuthErrorCode.EmailAlreadyRegistered, "The email address is already registered.");
        }

        // Initiate email verification for the now-persisted account (Requirement 2.6).
        // Token issuance and delivery are owned by the verification use case behind this
        // seam; a delivery failure does not undo the durably created account, and
        // verification can be re-initiated later (Requirement 4.6).
        await _emailVerification.InitiateAsync(user, ct);

        return Result<RegisterWithPasswordResult>.Ok(new RegisterWithPasswordResult(user.Id));
    }

    /// <summary>
    /// Uses a supplied display name when present and valid, otherwise derives one from the
    /// email's local part so a registration can succeed from email and password alone. The
    /// derived name is bounded to the 1–100 character range the <see cref="User"/> requires.
    /// </summary>
    private static string ResolveDisplayName(string? supplied, string normalisedEmail)
    {
        if (!string.IsNullOrWhiteSpace(supplied))
        {
            string trimmed = supplied.Trim();
            return trimmed.Length <= 100 ? trimmed : trimmed[..100];
        }

        string localPart = normalisedEmail[..normalisedEmail.IndexOf('@')];
        return localPart.Length <= 100 ? localPart : localPart[..100];
    }

    private static Result<RegisterWithPasswordResult> Fail(AuthErrorCode code, string message) =>
        Result<RegisterWithPasswordResult>.Fail(new AuthError(code, message));
}
