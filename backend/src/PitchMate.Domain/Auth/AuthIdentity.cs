using PitchMate.Domain.Common;

namespace PitchMate.Domain.Auth;

/// <summary>
/// A single way a <c>User</c> can prove who they are: the pairing of an
/// <see cref="AuthProvider"/> with the provider's own identifier for the person
/// (<see cref="ProviderUserId"/>). A <c>User</c> owns many identities and an incoming
/// authentication is resolved solely on the pair
/// (<see cref="Provider"/>, <see cref="ProviderUserId"/>), never on email address.
/// <para>
/// For <see cref="AuthProvider.Password"/> the <see cref="ProviderUserId"/> is the
/// normalised email and the identity carries its <see cref="Credential"/>. For an
/// external provider the <see cref="ProviderUserId"/> is the provider's subject and
/// no credential is held. The shape invariant — a <see cref="Credential"/> is present
/// if and only if <see cref="Provider"/> is <see cref="AuthProvider.Password"/> — is
/// enforced by the factories (Requirements 1.7, 1.8).
/// </para>
/// </summary>
public sealed class AuthIdentity : BaseEntity, IAnonymisable
{
    /// <summary>The identifier of the owning <c>User</c>.</summary>
    public Guid UserId { get; private set; }

    /// <summary>The authentication mechanism this identity uses.</summary>
    public AuthProvider Provider { get; private set; }

    /// <summary>
    /// The provider's own identifier for the person: the normalised email for
    /// <see cref="AuthProvider.Password"/>, or the provider's subject for an external
    /// provider.
    /// </summary>
    public string ProviderUserId { get; private set; }

    /// <summary>
    /// The password credential, present if and only if <see cref="Provider"/> is
    /// <see cref="AuthProvider.Password"/>.
    /// </summary>
    public PasswordCredential? Credential { get; private set; }

    private AuthIdentity(Guid userId, AuthProvider provider, string providerUserId, PasswordCredential? credential)
    {
        UserId = userId;
        Provider = provider;
        ProviderUserId = providerUserId;
        Credential = credential;
    }

    /// <summary>
    /// Creates a <see cref="AuthProvider.Password"/> identity for <paramref name="userId"/>,
    /// keyed on the normalised email and carrying the supplied credential.
    /// </summary>
    /// <param name="userId">The owning user's identifier.</param>
    /// <param name="normalisedEmail">The normalised email, used as the provider user id.</param>
    /// <param name="credential">The password credential for this identity.</param>
    /// <returns>The new Password <see cref="AuthIdentity"/>.</returns>
    /// <exception cref="ArgumentException">Thrown when <paramref name="normalisedEmail"/> is null, empty, or whitespace.</exception>
    /// <exception cref="ArgumentNullException">Thrown when <paramref name="credential"/> is null.</exception>
    public static AuthIdentity ForPassword(Guid userId, string normalisedEmail, PasswordCredential credential)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(normalisedEmail);
        ArgumentNullException.ThrowIfNull(credential);

        return new AuthIdentity(userId, AuthProvider.Password, normalisedEmail, credential);
    }

    /// <summary>
    /// Creates an external (non-Password) identity for <paramref name="userId"/>, keyed
    /// on the provider's subject. No credential is held.
    /// </summary>
    /// <param name="userId">The owning user's identifier.</param>
    /// <param name="provider">The external provider; must not be <see cref="AuthProvider.Password"/>.</param>
    /// <param name="providerUserId">The provider's subject for the person.</param>
    /// <returns>The new external <see cref="AuthIdentity"/>.</returns>
    /// <exception cref="ArgumentException">Thrown when <paramref name="provider"/> is <see cref="AuthProvider.Password"/>, or <paramref name="providerUserId"/> is null, empty, or whitespace.</exception>
    public static AuthIdentity ForExternal(Guid userId, AuthProvider provider, string providerUserId)
    {
        if (provider == AuthProvider.Password)
        {
            throw new ArgumentException(
                "An external identity must use a non-Password provider; use ForPassword for Password identities.",
                nameof(provider));
        }

        ArgumentException.ThrowIfNullOrWhiteSpace(providerUserId);

        return new AuthIdentity(userId, provider, providerUserId, credential: null);
    }

    /// <summary>
    /// Scrubs <see cref="ProviderUserId"/> to a fixed placeholder derived only from the
    /// non-PII <see cref="BaseEntity.Id"/>. Because an incoming authentication is
    /// resolved solely on the pair (<see cref="Provider"/>, <see cref="ProviderUserId"/>),
    /// the scrubbed value can no longer match any incoming assertion or resolve to the
    /// owning user, and no original identifying value is retained (Requirement 14.3).
    /// <para>
    /// The placeholder is derived deterministically from <see cref="BaseEntity.Id"/>, so
    /// the operation is idempotent and leaves <see cref="BaseEntity.Id"/>,
    /// <see cref="UserId"/>, <see cref="Provider"/>, relationships, and soft-delete state
    /// unchanged.
    /// </para>
    /// </summary>
    public void Anonymise() => ProviderUserId = $"anonymised-{Id:N}";
}
