namespace PitchMate.Application.Squads.Abstractions;

/// <summary>
/// The one-time output of generating an invite secret: the redeemable <paramref name="RedeemableLink"/>
/// and short <paramref name="Code"/> handed back to the caller exactly once, plus the one-way
/// <paramref name="TokenHash"/> that is the only part ever persisted. The redeemable secret is never
/// stored, so it cannot leak from the database; redemption re-hashes the presented secret and compares
/// it to the stored hash (Requirement 10.1, 10.4).
/// </summary>
/// <param name="RedeemableLink">The shareable join link containing the redeemable secret; returned once, never stored.</param>
/// <param name="Code">The short human-typeable code (8..12 characters) equivalent to the link; returned once, never stored.</param>
/// <param name="TokenHash">The one-way hash of the secret; the only value persisted on the invite.</param>
public sealed record InviteSecret(string RedeemableLink, string Code, string TokenHash);
