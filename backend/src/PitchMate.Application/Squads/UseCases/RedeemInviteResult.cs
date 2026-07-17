namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// Distinguishes how a successful invite redemption resolved, so callers can report the outcome
/// without inspecting membership state.
/// </summary>
public enum RedeemOutcome
{
    /// <summary>A new active registered member membership was created for the user (Requirement 11.1).</summary>
    Joined,

    /// <summary>The user's existing inactive membership was reactivated, preserving its history (Requirement 9.1, 11.4).</summary>
    Reactivated,

    /// <summary>The user already held an active membership; nothing changed (Requirement 9.6, 11.3).</summary>
    AlreadyMember,
}

/// <summary>
/// The output of a successful invite redemption: the identity of the membership the user now holds in
/// the squad together with how the redemption resolved (Requirement 9, 11). For every outcome the
/// <paramref name="MembershipId"/> identifies the single membership backing the user in that squad —
/// a newly created one when <see cref="RedeemOutcome.Joined"/>, or the user's existing membership when
/// <see cref="RedeemOutcome.Reactivated"/> or <see cref="RedeemOutcome.AlreadyMember"/>.
/// </summary>
/// <param name="MembershipId">The identity of the membership the user holds in the squad.</param>
/// <param name="Outcome">How the redemption resolved.</param>
public sealed record RedeemInviteResult(
    Guid MembershipId,
    RedeemOutcome Outcome);
