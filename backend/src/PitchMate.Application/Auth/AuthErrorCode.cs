namespace PitchMate.Application.Auth;

/// <summary>
/// Stable, closed enumeration of every failure an authentication or identity use case can report.
/// The accompanying <see cref="AuthError.Message"/> is for diagnostics only and is never parsed.
/// Codes map to HTTP results at the Api edge.
/// </summary>
public enum AuthErrorCode
{
    /// <summary>An <c>AuthIdentity</c> already exists for the supplied <c>(Provider, ProviderUserId)</c> pair.</summary>
    DuplicateIdentity,

    /// <summary>Registration was attempted with an email already bound to a Password identity.</summary>
    EmailAlreadyRegistered,

    /// <summary>A supplied password failed the password-strength policy.</summary>
    PasswordPolicy,

    /// <summary>An email address was malformed or otherwise failed validation.</summary>
    InvalidEmail,

    /// <summary>A token (access, refresh, verification, or reset) had passed its expiry.</summary>
    TokenExpired,

    /// <summary>A token was malformed, unknown, already redeemed, tampered with, or otherwise not valid.</summary>
    TokenInvalid,

    /// <summary>Sign-in failed; returned generically so existing and non-existing accounts are indistinguishable.</summary>
    AuthenticationFailed,

    /// <summary>An operation required a verified email address and the account's email was unverified.</summary>
    EmailNotVerified,

    /// <summary>Input failed structural validation before any further processing.</summary>
    ValidationFailed,

    /// <summary>An outbound email could not be delivered after the configured retry budget.</summary>
    DeliveryFailed,

    /// <summary>The operation would remove the user's last remaining sign-in method.</summary>
    LastIdentity,

    /// <summary>A Password identity already exists for the user; a second cannot be added.</summary>
    PasswordMethodExists,

    /// <summary>The external identity being linked is already attached to an account.</summary>
    IdentityAlreadyLinked,

    /// <summary>The request required an authenticated caller and none was present.</summary>
    Unauthenticated,

    /// <summary>The referenced user does not exist.</summary>
    UserNotFound
}
