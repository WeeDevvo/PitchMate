using PitchMate.Domain.Auth;

namespace PitchMate.Application.Auth.Gdpr;

/// <summary>
/// The data-subject export (DSAR) record for a single user, containing exactly the user's
/// non-secret auth data: their display name, email address, email-verification state, and
/// the <see cref="AuthProvider"/> of each owned identity (Requirement 14.4).
/// <para>
/// The record deliberately carries no secret material — no password hash, no refresh-token
/// hash, and no stored verification/reset token hash — and no provider subject or other
/// resolving identifier; only the <see cref="AuthProvider"/> kind of each identity is
/// disclosed.
/// </para>
/// </summary>
/// <param name="DisplayName">The user's squad-facing display name.</param>
/// <param name="Email">The user's email address.</param>
/// <param name="EmailVerified">Whether the user has verified ownership of their email.</param>
/// <param name="Providers">The provider kind of each <see cref="AuthIdentity"/> the user owns.</param>
public sealed record UserDataExport(
    string DisplayName,
    string Email,
    bool EmailVerified,
    IReadOnlyList<AuthProvider> Providers);
