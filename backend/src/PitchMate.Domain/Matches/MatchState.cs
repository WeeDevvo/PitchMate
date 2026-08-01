namespace PitchMate.Domain.Matches;

/// <summary>
/// The closed lifecycle state of a <c>Match</c>, walking a draft from availability
/// gathering through to a completed, rating-affecting result, plus the admin-initiated
/// cancelled terminal state.
/// <para>
/// Persistence stores the stable numeric value, so members must not be renumbered or
/// removed once shipped. <c>Completed</c> and <c>Cancelled</c> are terminal: no transition
/// leaves either.
/// </para>
/// </summary>
public enum MatchState
{
    /// <summary>Registered members are marking which candidate days they can make; the opening state after a draft is created.</summary>
    GatheringAvailability = 1,

    /// <summary>An admin has confirmed the match on a candidate day that met the squad's minimum threshold; participants are seeded.</summary>
    Confirmed = 2,

    /// <summary>Teams have been rolled and locked, capturing the immutable kickoff lineup.</summary>
    TeamsRolled = 3,

    /// <summary>The match is being played; the kickoff lineup is retained as the sole rating input.</summary>
    InProgress = 4,

    /// <summary>The match has been played and its result recorded; the rating update has been applied. Terminal.</summary>
    Completed = 5,

    /// <summary>The match was cancelled by an admin before play; no rating update is applied. Terminal.</summary>
    Cancelled = 6
}
