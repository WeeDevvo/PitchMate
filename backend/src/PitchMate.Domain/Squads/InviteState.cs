namespace PitchMate.Domain.Squads;

/// <summary>
/// The state of a squad invite link/code.
/// </summary>
public enum InviteState
{
    /// <summary>The invite is currently valid and may be redeemed.</summary>
    Active = 1,

    /// <summary>The invite has been explicitly revoked by an admin.</summary>
    Revoked = 2,

    /// <summary>The invite has passed its expiry time. This state is derived from the clock and never persisted.</summary>
    Expired = 3
}
