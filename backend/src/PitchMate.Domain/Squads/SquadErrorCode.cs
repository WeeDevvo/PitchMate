namespace PitchMate.Domain.Squads;

/// <summary>
/// Stable, switchable enumeration of every failure a squad or membership operation can report.
/// The accompanying <see cref="SquadError.Message"/> is for diagnostics only and is never parsed by callers.
/// </summary>
public enum SquadErrorCode
{
    /// <summary>An input violated a validation rule (e.g. empty or malformed name, out-of-range value).</summary>
    ValidationFailed,

    /// <summary>The requested display name is already taken by another member or guest within the squad.</summary>
    DisplayNameInUse,

    /// <summary>The caller lacks the permission required to perform the operation.</summary>
    Unauthorized,

    /// <summary>The caller is not an active member of the squad the operation targets.</summary>
    NotAMember,

    /// <summary>The operation would violate the single-owner constraint (e.g. an owner leaving without transferring).</summary>
    OwnerConstraint,

    /// <summary>The user or guest is already a member of the squad.</summary>
    AlreadyMember,

    /// <summary>The invite is revoked, expired, or otherwise not in a usable state.</summary>
    InviteUnusable,

    /// <summary>The invite has reached its configured maximum number of uses.</summary>
    InviteLimitReached,

    /// <summary>An expiry value is required for this invite but was not supplied.</summary>
    ExpiryRequired,

    /// <summary>The guest membership is not eligible to be claimed/linked to a user.</summary>
    ClaimNotEligible,

    /// <summary>The squad is in a pending-deletion (soft-deleted) state and cannot accept the operation.</summary>
    SquadPendingDeletion,

    /// <summary>A concurrent modification was detected; the operation must be retried against fresh state.</summary>
    ConcurrencyConflict
}
