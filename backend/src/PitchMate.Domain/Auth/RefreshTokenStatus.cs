namespace PitchMate.Domain.Auth;

/// <summary>
/// The lifecycle state of a <see cref="RefreshToken"/> within its token family. A
/// family holds <strong>at most one <see cref="Active"/> token at any instant</strong>
/// (Requirement 9.7): presenting an <see cref="Active"/> token to refresh rotates it
/// to <see cref="Rotated"/> and issues a new <see cref="Active"/> successor, while
/// presenting a <see cref="Rotated"/> or <see cref="Revoked"/> token is reuse and
/// revokes the whole family.
/// <para>
/// Numeric values are assigned explicitly and are stable, because they are persisted.
/// </para>
/// </summary>
public enum RefreshTokenStatus
{
    /// <summary>The single live token in the family; may be presented to refresh.</summary>
    Active = 1,

    /// <summary>Superseded by a successor during rotation; re-presentation is reuse.</summary>
    Rotated = 2,

    /// <summary>Explicitly invalidated (sign-out, password reset, or reuse detection).</summary>
    Revoked = 3,
}
