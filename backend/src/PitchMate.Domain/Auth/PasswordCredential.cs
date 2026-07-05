using PitchMate.Domain.Common;

namespace PitchMate.Domain.Auth;

/// <summary>
/// The secret material behind a <see cref="AuthProvider.Password"/>
/// <see cref="AuthIdentity"/>. Exactly one credential exists per Password identity,
/// enforced by a unique foreign key to <see cref="AuthIdentity"/>.
/// <para>
/// Only a one-way, salted password hash is ever stored — the encoded
/// <see cref="PasswordHash"/> carries the algorithm, salt, and work factor. No
/// plaintext or otherwise recoverable form of the password is persisted at any point
/// (Requirement 2.2).
/// </para>
/// </summary>
public sealed class PasswordCredential : BaseEntity
{
    /// <summary>
    /// The identifier of the owning <see cref="AuthProvider.Password"/>
    /// <see cref="AuthIdentity"/>. The unique foreign key is an EF mapping concern;
    /// the Domain holds only the identifier.
    /// </summary>
    public Guid AuthIdentityId { get; private set; }

    /// <summary>
    /// The one-way salted password hash, encoding the algorithm, salt, and work factor.
    /// Never plaintext and never recoverable.
    /// </summary>
    public string PasswordHash { get; private set; }

    private PasswordCredential(string passwordHash) => PasswordHash = passwordHash;

    /// <summary>
    /// Creates a new credential holding the supplied one-way password hash.
    /// </summary>
    /// <param name="passwordHash">The encoded, salted, one-way password hash.</param>
    /// <returns>The new <see cref="PasswordCredential"/>.</returns>
    /// <exception cref="ArgumentException">Thrown when <paramref name="passwordHash"/> is null, empty, or whitespace.</exception>
    public static PasswordCredential Create(string passwordHash)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(passwordHash);
        return new PasswordCredential(passwordHash);
    }

    /// <summary>
    /// Replaces the stored hash with <paramref name="newHash"/>, used when a password is
    /// reset or transparently re-hashed on verify to upgrade weak parameters.
    /// </summary>
    /// <param name="newHash">The new encoded, salted, one-way password hash.</param>
    /// <exception cref="ArgumentException">Thrown when <paramref name="newHash"/> is null, empty, or whitespace.</exception>
    public void ReplaceHash(string newHash)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(newHash);
        PasswordHash = newHash;
    }
}
