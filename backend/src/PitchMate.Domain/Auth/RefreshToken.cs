using PitchMate.Domain.Common;

namespace PitchMate.Domain.Auth;

/// <summary>
/// A server-side row in the refresh-token revocation store: the persisted, one-way
/// hash of a rotating refresh token together with its lifecycle state. The plaintext
/// secret is returned to the caller exactly once at issuance and never stored; only
/// <see cref="TokenHash"/> is held, and an incoming token is matched by hashing the
/// presented secret and comparing against the stored hash (Requirements 9.1, 9.6).
/// <para>
/// Tokens are grouped into a <em>family</em> sharing a <see cref="TokenFamilyId"/>: a
/// sign-in starts a family with <see cref="StartFamily"/>, and each refresh
/// <see cref="Rotate"/>s the current token to <see cref="RefreshTokenStatus.Rotated"/>
/// and issues a new <see cref="RefreshTokenStatus.Active"/> successor in the same
/// family. The store maintains <strong>at most one <see cref="RefreshTokenStatus.Active"/>
/// token per family</strong> (Requirement 9.7); re-presenting a rotated or revoked
/// token is reuse and revokes the whole family.
/// </para>
/// </summary>
public sealed class RefreshToken : BaseEntity
{
    /// <summary>The identifier of the owning <c>User</c> whose session this token represents.</summary>
    public Guid UserId { get; private set; }

    /// <summary>The chain identifier shared by every token in this family (the Token_Family).</summary>
    public Guid TokenFamilyId { get; private set; }

    /// <summary>
    /// The one-way hash of the refresh-token secret. The plaintext is returned to the
    /// caller once at issuance and never persisted.
    /// </summary>
    public string TokenHash { get; private set; }

    /// <summary>The lifecycle state of this token within its family.</summary>
    public RefreshTokenStatus Status { get; private set; }

    /// <summary>The UTC instant after which this token is no longer valid.</summary>
    public DateTimeOffset ExpiresAt { get; private set; }

    private RefreshToken(Guid userId, Guid tokenFamilyId, string tokenHash, RefreshTokenStatus status, DateTimeOffset expiresAt)
    {
        UserId = userId;
        TokenFamilyId = tokenFamilyId;
        TokenHash = tokenHash;
        Status = status;
        ExpiresAt = expiresAt;
    }

    /// <summary>
    /// Starts a new token family for <paramref name="userId"/>: the family head is a
    /// fresh <see cref="RefreshTokenStatus.Active"/> token with a newly generated
    /// <see cref="TokenFamilyId"/>.
    /// </summary>
    /// <param name="userId">The owning user's identifier.</param>
    /// <param name="tokenHash">The one-way hash of the issued refresh-token secret.</param>
    /// <param name="expiresAt">The UTC instant after which the token is no longer valid.</param>
    /// <returns>The new <see cref="RefreshTokenStatus.Active"/> family head.</returns>
    /// <exception cref="ArgumentException">Thrown when <paramref name="tokenHash"/> is null, empty, or whitespace.</exception>
    public static RefreshToken StartFamily(Guid userId, string tokenHash, DateTimeOffset expiresAt)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(tokenHash);

        return new RefreshToken(userId, Guid.CreateVersion7(), tokenHash, RefreshTokenStatus.Active, expiresAt);
    }

    /// <summary>
    /// Rotates this token: marks it <see cref="RefreshTokenStatus.Rotated"/> and returns
    /// a new <see cref="RefreshTokenStatus.Active"/> successor in the same
    /// <see cref="TokenFamilyId"/> for the same <see cref="UserId"/>.
    /// </summary>
    /// <param name="successorHash">The one-way hash of the successor refresh-token secret.</param>
    /// <param name="expiresAt">The UTC instant after which the successor is no longer valid.</param>
    /// <returns>The new <see cref="RefreshTokenStatus.Active"/> successor token.</returns>
    /// <exception cref="ArgumentException">Thrown when <paramref name="successorHash"/> is null, empty, or whitespace.</exception>
    public RefreshToken Rotate(string successorHash, DateTimeOffset expiresAt)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(successorHash);

        Status = RefreshTokenStatus.Rotated;

        return new RefreshToken(UserId, TokenFamilyId, successorHash, RefreshTokenStatus.Active, expiresAt);
    }

    /// <summary>
    /// Revokes this token, setting <see cref="Status"/> to
    /// <see cref="RefreshTokenStatus.Revoked"/> (sign-out, password reset, or reuse
    /// detection).
    /// </summary>
    public void Revoke() => Status = RefreshTokenStatus.Revoked;

    /// <summary>
    /// Indicates whether this token is usable at <paramref name="now"/>: it is
    /// <see cref="RefreshTokenStatus.Active"/> and has not yet expired.
    /// </summary>
    /// <param name="now">The UTC instant to evaluate against.</param>
    /// <returns><see langword="true"/> when active and unexpired; otherwise <see langword="false"/>.</returns>
    public bool IsActiveAt(DateTimeOffset now) => Status == RefreshTokenStatus.Active && now < ExpiresAt;
}
