namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// A request by an authenticated user to redeem an invite secret and join a squad (Requirement 11.1).
/// The <paramref name="PresentedSecret"/> is the value embedded in an invite link or the short code;
/// the handler hashes it and matches it against the stored one-way token hash, never the secret
/// itself (Requirement 10.4, 11.1).
/// <para>
/// When the user already holds an inactive membership in the target squad the same membership is
/// reactivated rather than a second one created (Requirement 9.1, 11.4); when the user already holds
/// an active membership the redemption is a no-op success (Requirement 9.6, 11.3).
/// </para>
/// <para>
/// <paramref name="DisplayName"/> is optional: when supplied it is used (trimmed) for the new or
/// reactivated membership; when <see langword="null"/> a new join derives the display name from the
/// user's identity display name (Requirement 11.7) and a reactivation keeps the membership's existing
/// display name. A supplied or derived name that is empty, exceeds 50 characters, or collides with an
/// existing non-anonymised membership is rejected so the caller can supply a distinct one
/// (Requirement 9.5, 11.7, 11.8).
/// </para>
/// </summary>
/// <param name="ActingUserId">The authenticated user redeeming the invite.</param>
/// <param name="PresentedSecret">The invite secret presented for redemption (link value or short code).</param>
/// <param name="DisplayName">
/// An optional display name to apply to the new or reactivated membership, or <see langword="null"/>
/// to derive it (new join) or keep the existing one (reactivation).
/// </param>
public sealed record RedeemInviteCommand(
    Guid ActingUserId,
    string PresentedSecret,
    string? DisplayName = null);
