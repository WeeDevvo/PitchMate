using PitchMate.Domain.Common;

namespace PitchMate.Domain.Auth;

/// <summary>
/// A registered person: their squad-facing identity (<see cref="DisplayName"/>),
/// contact email, verification state, optional avatar, and the set of ways they can
/// authenticate (<see cref="Identities"/>). A <c>User</c> owns many
/// <see cref="AuthIdentity"/> rows and an incoming authentication is resolved on the
/// pair (<see cref="AuthIdentity.Provider"/>, <see cref="AuthIdentity.ProviderUserId"/>),
/// never on the email address.
/// <para>
/// The email is expected to arrive already normalised by the caller; the entity only
/// guards that it is non-empty. As an <see cref="IAnonymisable"/>, the user can have its
/// PII stripped on erasure while its <see cref="BaseEntity.Id"/> and relationships are
/// retained so immutable matches and rating replay stay valid (Requirements 14.1, 14.5).
/// </para>
/// </summary>
public sealed class User : BaseEntity, IAnonymisable
{
    /// <summary>The fixed, de-identified display name applied on anonymisation.</summary>
    public const string DisplayNamePlaceholder = "Former player";

    private readonly List<AuthIdentity> _identities = [];

    /// <summary>The user's squad-facing name; 1–100 characters.</summary>
    public string DisplayName { get; private set; }

    /// <summary>The user's normalised, non-empty contact email.</summary>
    public string Email { get; private set; }

    /// <summary>Whether the user has verified ownership of their <see cref="Email"/>.</summary>
    public bool EmailVerified { get; private set; }

    /// <summary>An optional reference to the user's avatar in object storage.</summary>
    public string? AvatarReference { get; private set; }

    /// <summary>The ways this user can authenticate, resolved on (provider, provider user id).</summary>
    public IReadOnlyCollection<AuthIdentity> Identities => _identities;

    private User(string displayName, string email, bool emailVerified, string? avatarReference)
    {
        DisplayName = displayName;
        Email = email;
        EmailVerified = emailVerified;
        AvatarReference = avatarReference;
    }

    /// <summary>
    /// Creates a new <see cref="User"/>. The <paramref name="normalisedEmail"/> is expected
    /// to have already been normalised by the caller and is only guarded against being empty.
    /// </summary>
    /// <param name="displayName">The squad-facing name; must be 1–100 characters.</param>
    /// <param name="normalisedEmail">The already-normalised, non-empty contact email.</param>
    /// <param name="emailVerified">Whether the email is already verified; defaults to <see langword="false"/>.</param>
    /// <param name="avatarReference">An optional avatar reference.</param>
    /// <returns>The new <see cref="User"/>.</returns>
    /// <exception cref="ArgumentException">Thrown when <paramref name="displayName"/> is not 1–100 characters, or <paramref name="normalisedEmail"/> is null, empty, or whitespace.</exception>
    public static User Create(
        string displayName,
        string normalisedEmail,
        bool emailVerified = false,
        string? avatarReference = null)
    {
        ValidateDisplayName(displayName);
        ArgumentException.ThrowIfNullOrWhiteSpace(normalisedEmail);

        return new User(displayName, normalisedEmail, emailVerified, avatarReference);
    }

    /// <summary>
    /// Marks the user's email as verified. Idempotent: calling it when the email is
    /// already verified is a safe no-op (Requirement 4.9).
    /// </summary>
    public void MarkEmailVerified() => EmailVerified = true;

    /// <summary>
    /// Updates the user's <see cref="DisplayName"/>.
    /// </summary>
    /// <param name="displayName">The new squad-facing name; must be 1–100 characters.</param>
    /// <exception cref="ArgumentException">Thrown when <paramref name="displayName"/> is not 1–100 characters.</exception>
    public void ChangeDisplayName(string displayName)
    {
        ValidateDisplayName(displayName);
        DisplayName = displayName;
    }

    /// <summary>
    /// Strips the user's PII, replacing it with fixed placeholders derived only from the
    /// non-PII <see cref="BaseEntity.Id"/>: <see cref="DisplayName"/> becomes
    /// <see cref="DisplayNamePlaceholder"/>, <see cref="Email"/> becomes a non-routable
    /// address under the reserved <c>.invalid</c> TLD, <see cref="EmailVerified"/> is
    /// cleared, and <see cref="AvatarReference"/> is removed (Requirements 14.1, 14.5).
    /// <para>
    /// The placeholders contain none of the original identifying content and are derived
    /// deterministically from <see cref="BaseEntity.Id"/>, so the operation is idempotent
    /// and leaves <see cref="BaseEntity.Id"/>, the <see cref="Identities"/> relationship,
    /// and soft-delete state unchanged.
    /// </para>
    /// </summary>
    public void Anonymise()
    {
        DisplayName = DisplayNamePlaceholder;
        Email = $"anonymised+{Id:N}@users.invalid";
        EmailVerified = false;
        AvatarReference = null;
    }

    private static void ValidateDisplayName(string displayName)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(displayName);

        if (displayName.Length > 100)
        {
            throw new ArgumentException(
                "Display name must be 1\u2013100 characters.",
                nameof(displayName));
        }
    }
}
