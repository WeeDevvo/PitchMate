using PitchMate.Application.Auth.Abstractions;
using PitchMate.Application.Common.Persistence;
using PitchMate.Domain.Auth;

namespace PitchMate.Application.Auth.UseCases;

/// <summary>
/// Signs a visitor in with Google (Requirement 7). The handler validates the assertion through the
/// <see cref="IExternalProviderVerifier"/> (signature, issuer, audience, expiry, and a present subject),
/// then resolves the principal <strong>solely</strong> on the provider key
/// (<see cref="AuthProvider.Google"/>, subject) via <see cref="IAuthIdentityRepository"/> —
/// <strong>never</strong> on email address (Requirements 7.4, 7.6).
/// <list type="bullet">
///   <item>When the subject matches an existing <see cref="AuthProvider.Google"/> identity, a session
///   is established for that identity's owning <see cref="User"/> and no records are created
///   (Requirement 7.4).</item>
///   <item>When the subject matches no <see cref="AuthProvider.Google"/> identity, a new
///   <see cref="User"/> and a new <see cref="AuthProvider.Google"/> <see cref="AuthIdentity"/> are
///   created for that subject — even if the asserted email already belongs to another user, the
///   accounts are never merged (Requirements 7.5, 7.6). The created user's
///   <see cref="User.EmailVerified"/> mirrors the assertion's <c>email_verified</c> claim
///   (Requirements 7.8, 7.9).</item>
/// </list>
/// Establishing a session issues an access token and starts a new refresh-token family, persisting only
/// the refresh-token hash (Requirement 9.1, 9.6). An assertion the verifier rejects, or one carrying no
/// subject, yields a generic authentication failure that creates nothing and leaves existing records
/// unchanged (Requirements 7.3, 7.7).
/// </summary>
public sealed class SignInWithGoogleHandler
{
    private readonly IExternalProviderVerifier _verifier;
    private readonly IUserRepository _users;
    private readonly IAuthIdentityRepository _identities;
    private readonly ITokenService _tokenService;
    private readonly IRefreshTokenStore _refreshTokens;
    private readonly IUnitOfWork _unitOfWork;

    /// <summary>
    /// Creates the handler with the external-provider verifier, repositories, token service, refresh-token
    /// store, and unit of work it commits through.
    /// </summary>
    public SignInWithGoogleHandler(
        IExternalProviderVerifier verifier,
        IUserRepository users,
        IAuthIdentityRepository identities,
        ITokenService tokenService,
        IRefreshTokenStore refreshTokens,
        IUnitOfWork unitOfWork)
    {
        ArgumentNullException.ThrowIfNull(verifier);
        ArgumentNullException.ThrowIfNull(users);
        ArgumentNullException.ThrowIfNull(identities);
        ArgumentNullException.ThrowIfNull(tokenService);
        ArgumentNullException.ThrowIfNull(refreshTokens);
        ArgumentNullException.ThrowIfNull(unitOfWork);

        _verifier = verifier;
        _users = users;
        _identities = identities;
        _tokenService = tokenService;
        _refreshTokens = refreshTokens;
        _unitOfWork = unitOfWork;
    }

    /// <summary>
    /// Handles a <see cref="SignInWithGoogleCommand"/>, returning the established
    /// <see cref="AuthSession"/> on success or a generic
    /// <see cref="AuthErrorCode.AuthenticationFailed"/> on a rejected or subject-less assertion.
    /// </summary>
    /// <param name="command">The Google sign-in request carrying the assertion.</param>
    /// <param name="ct">A token to cancel the operation.</param>
    public async Task<Result<AuthSession>> HandleAsync(SignInWithGoogleCommand command, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(command);

        // Validate the assertion (Requirements 7.1, 7.3, 7.7). The verifier owns signature/issuer/
        // audience/expiry checks and rejects an assertion with no subject; a failure here creates
        // nothing and leaves existing records unchanged.
        Result<ExternalIdentity> verification =
            await _verifier.ValidateAsync(AuthProvider.Google, command.Assertion ?? string.Empty, ct);
        if (!verification.IsSuccess)
        {
            return AuthFailure();
        }

        ExternalIdentity external = verification.Value!;

        // Defence in depth: only a Google assertion bearing a subject can resolve or create a Google
        // identity (Requirement 7.3). A verifier that already enforces this makes this a no-op.
        if (external.Provider != AuthProvider.Google || string.IsNullOrWhiteSpace(external.ProviderUserId))
        {
            return AuthFailure();
        }

        // Resolve solely on the pair (Google, subject) — never on email (Requirements 7.4, 7.6).
        AuthIdentity? identity =
            await _identities.FindByProviderKeyAsync(AuthProvider.Google, external.ProviderUserId, ct);

        User user;
        if (identity is not null)
        {
            // Existing Google identity: the session belongs to its owning user; create nothing
            // (Requirement 7.4).
            User? owner = await _users.GetByIdAsync(identity.UserId, ct);
            if (owner is null)
            {
                // The identity references a user that no longer exists. Fail generically rather than
                // fabricate a session for a missing principal.
                return AuthFailure();
            }

            user = owner;
        }
        else
        {
            // No matching Google identity: create a brand-new user and Google identity keyed on the
            // subject, never attaching to whoever may hold the asserted email (Requirements 7.5, 7.6).
            user = CreateUserFromAssertion(external);
            AuthIdentity newIdentity =
                AuthIdentity.ForExternal(user.Id, AuthProvider.Google, external.ProviderUserId);

            await _users.AddAsync(user, ct);
            await _identities.AddAsync(newIdentity, ct);
        }

        // Establish the session: issue an access token and start a fresh refresh-token family,
        // persisting only the refresh-token hash (Requirements 7.4, 7.5, 9.1, 9.6).
        AccessTokenResult accessToken = _tokenService.IssueAccessToken(user);
        RefreshTokenSecret refreshSecret = _tokenService.GenerateRefreshToken();
        RefreshToken refreshToken =
            RefreshToken.StartFamily(user.Id, refreshSecret.Hash, refreshSecret.ExpiresAt);

        await _refreshTokens.AddAsync(refreshToken, ct);

        try
        {
            // Persist the new account graph (when created) and the refresh-token family head atomically.
            await _unitOfWork.SaveChangesAsync(ct);
        }
        catch (DuplicateKeyException)
        {
            // A concurrent first-time sign-in for the same subject won the race on the unique
            // (Provider, ProviderUserId) index. Nothing from this operation was persisted; the client
            // can retry and resolve the now-existing identity (Requirement 7.5).
            return AuthFailure();
        }

        return Result<AuthSession>.Ok(new AuthSession(
            user.Id,
            accessToken.Token,
            accessToken.ExpiresAt,
            refreshSecret.Plaintext,
            refreshSecret.ExpiresAt));
    }

    /// <summary>
    /// Builds a new <see cref="User"/> from a validated Google assertion. The email — when the
    /// assertion carries one — is recorded in its normalised form with verification mirroring the
    /// <c>email_verified</c> claim (Requirements 7.8, 7.9); when the assertion carries no email, a
    /// non-routable placeholder under the reserved <c>.invalid</c> TLD is recorded as unverified so the
    /// account can still be created (resolution never relies on the email regardless). The display name
    /// is derived from the email's local part and bounded to the user's 1–100 character range.
    /// </summary>
    private static User CreateUserFromAssertion(ExternalIdentity external)
    {
        string normalisedEmail;
        bool emailVerified;

        if (!string.IsNullOrWhiteSpace(external.Email))
        {
            normalisedEmail = EmailAddress.Normalise(external.Email);
            emailVerified = external.EmailVerified;
        }
        else
        {
            // No email claim: synthesise a stable, non-routable address from the subject. The email is
            // never a resolution key, so this only satisfies the user's non-empty-email invariant.
            normalisedEmail = $"google-{external.ProviderUserId}@users.noreply.invalid";
            emailVerified = false;
        }

        return User.Create(DeriveDisplayName(normalisedEmail), normalisedEmail, emailVerified);
    }

    /// <summary>
    /// Derives a squad-facing display name from the email's local part, bounded to the 1–100 character
    /// range the <see cref="User"/> requires.
    /// </summary>
    private static string DeriveDisplayName(string normalisedEmail)
    {
        int atIndex = normalisedEmail.IndexOf('@');
        string localPart = atIndex > 0 ? normalisedEmail[..atIndex] : normalisedEmail;
        return localPart.Length <= 100 ? localPart : localPart[..100];
    }

    private static Result<AuthSession> AuthFailure() =>
        Result<AuthSession>.Fail(new AuthError(
            AuthErrorCode.AuthenticationFailed,
            "The Google sign-in could not be completed."));
}
