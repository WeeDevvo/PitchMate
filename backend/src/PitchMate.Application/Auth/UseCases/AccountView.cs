namespace PitchMate.Application.Auth.UseCases;

/// <summary>
/// The authenticated caller's own account, as read by <see cref="GetAccountHandler"/> for the
/// account-settings surface: the caller's identity, profile, email-verification state, optional
/// avatar reference, and one <see cref="LinkedIdentityView"/> per linked sign-in method
/// (Requirement 8.3).
/// <para>
/// No member of this record, nor of any type reachable from it, names or carries a provider
/// subject, a password credential, or token material (Requirement 8.7). It is a distinct read
/// model from the DSAR <see cref="Gdpr.UserDataExport"/> so that a field added here for account
/// settings cannot reach the export (Requirement 9.4).
/// </para>
/// <para>
/// <see cref="LinkedIdentities"/> is never empty for an existing user, because unlinking never
/// removes a user's last sign-in method (Requirement 8.10), and its order is deterministic for a
/// given set of identities so a client rendering it is stable across calls (Requirement 8.5).
/// </para>
/// </summary>
/// <param name="UserId">The caller's own user identifier.</param>
/// <param name="DisplayName">The caller's squad-facing display name.</param>
/// <param name="Email">The caller's email address.</param>
/// <param name="EmailVerified">Whether the caller has verified ownership of their email.</param>
/// <param name="AvatarReference">A reference to the caller's avatar in object storage, or <see langword="null"/> when none is set.</param>
/// <param name="LinkedIdentities">The caller's linked sign-in methods, in a deterministic order.</param>
public sealed record AccountView(
    Guid UserId,
    string DisplayName,
    string Email,
    bool EmailVerified,
    string? AvatarReference,
    IReadOnlyList<LinkedIdentityView> LinkedIdentities);
