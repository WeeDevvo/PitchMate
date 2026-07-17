namespace PitchMate.Api.Squads.Endpoints;

/// <summary>
/// The body of an invite-redemption request (Requirements 9, 11). The
/// <paramref name="PresentedSecret"/> is the value embedded in an invite link or the short code; the
/// handler hashes it and matches it against the stored one-way token hash, never the secret itself.
/// <paramref name="DisplayName"/> is optional: when supplied it is used for the new or reactivated
/// membership; when omitted a new join derives it from the user's identity and a reactivation keeps
/// the existing name. The joining user is resolved from the access token.
/// </summary>
/// <param name="PresentedSecret">The invite secret presented for redemption (link value or short code).</param>
/// <param name="DisplayName">An optional display name for the new or reactivated membership.</param>
public sealed record RedeemInviteRequest(string PresentedSecret, string? DisplayName = null);
