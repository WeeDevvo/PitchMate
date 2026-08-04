namespace PitchMate.Domain.LiveTracking;

/// <summary>
/// Stable, switchable enumeration of every failure a live-tracking operation can report.
/// The accompanying <see cref="LiveTrackingError.Message"/> is for diagnostics only and is never
/// parsed by callers. Mirrors the discriminated-result convention of
/// <see cref="PitchMate.Domain.Squads.SquadErrorCode"/>.
/// </summary>
public enum LiveTrackingErrorCode
{
    /// <summary>An input violated a validation rule (bad <c>Event_Id</c>, missing/invalid field, minute out of range, kind mismatch, or an empty batch).</summary>
    ValidationFailed,

    /// <summary>The caller lacks the permission required to perform the operation.</summary>
    Unauthorized,

    /// <summary>The squad does not have the <c>LiveMatchTracking</c> feature enabled.</summary>
    NotEnabled,

    /// <summary>The match has not started (its state is before <c>InProgress</c>).</summary>
    MatchNotStarted,

    /// <summary>The match log is sealed because the match is <c>Completed</c> or <c>Cancelled</c>.</summary>
    LogSealed,

    /// <summary>A retraction named a target event that does not exist in the match.</summary>
    TargetNotFound,

    /// <summary>The requested match or resource was not found (also used to conceal existence from unauthorised callers).</summary>
    NotFound
}
