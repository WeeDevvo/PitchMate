namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// The one-time output of a successful invite generation: the created invite's identity together with
/// the redeemable <paramref name="RedeemableLink"/> and short <paramref name="Code"/> handed back to
/// the requesting client exactly once (Requirement 10.1). The redeemable secret is never persisted —
/// only its one-way hash is stored — so this result is the only opportunity to surface it. The
/// <paramref name="ExpiresAt"/> instant is <see langword="null"/> for a non-expiring invite
/// (Requirement 10.2, 10.3).
/// </summary>
/// <param name="InviteId">The identity of the created invite.</param>
/// <param name="RedeemableLink">The shareable join link containing the redeemable secret; returned once, never stored.</param>
/// <param name="Code">The short human-typeable code (8..12 characters) equivalent to the link; returned once, never stored.</param>
/// <param name="ExpiresAt">The expiry instant, or <see langword="null"/> for a non-expiring invite.</param>
public sealed record GenerateInviteResult(
    Guid InviteId,
    string RedeemableLink,
    string Code,
    DateTimeOffset? ExpiresAt);
