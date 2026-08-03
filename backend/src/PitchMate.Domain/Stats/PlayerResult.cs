namespace PitchMate.Domain.Stats;

/// <summary>
/// A single <c>Squad_Membership</c>'s outcome in one <c>Completed_Match</c> it appeared in, derived
/// from its kickoff team's placement in the match outcome: <see cref="Win"/> for the uniquely best
/// placement, <see cref="Draw"/> for a best placement shared with one or more other teams, and
/// <see cref="Loss"/> for a placement worse than the best (Requirement 6.1, 6.5).
/// </summary>
public enum PlayerResult
{
    /// <summary>The membership's kickoff team held the uniquely best placement in the match outcome.</summary>
    Win,

    /// <summary>The membership's kickoff team shared the best placement with one or more other teams.</summary>
    Draw,

    /// <summary>The membership's kickoff team placed worse than the best placement.</summary>
    Loss
}
