namespace PitchMate.Domain.Matches;

/// <summary>
/// Stable, switchable enumeration of every failure a match-lifecycle operation can report.
/// The accompanying <see cref="MatchError.Message"/> is for diagnostics only and is never parsed by callers.
/// </summary>
public enum MatchErrorCode
{
    /// <summary>An input violated a validation rule (e.g. out-of-range location, day count, or score).</summary>
    ValidationFailed,

    /// <summary>The caller lacks the permission required to perform the operation.</summary>
    Unauthorized,

    /// <summary>The operation is not permitted from the match's current lifecycle state.</summary>
    InvalidState,

    /// <summary>The available player count did not meet the squad's minimum threshold for confirmation.</summary>
    ThresholdNotMet,

    /// <summary>The targeted membership is not a participant of the match.</summary>
    NotAParticipant,

    /// <summary>The targeted membership is already a participant of the match.</summary>
    AlreadyParticipant,

    /// <summary>A rich (live-tracked) result was requested but the squad has live match tracking disabled.</summary>
    LiveTrackingDisabled,

    /// <summary>Completion was requested but no result has been recorded for the match.</summary>
    ResultRequired,

    /// <summary>A concurrent modification was detected; the operation must be retried against fresh state.</summary>
    ConcurrencyConflict
}
