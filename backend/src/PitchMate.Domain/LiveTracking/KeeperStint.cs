namespace PitchMate.Domain.LiveTracking;

/// <summary>
/// A derived period during which one membership kept goal for one team (Requirement 4.2): the
/// <see cref="TeamId"/> being kept, the <see cref="KeeperMembershipId"/> in goal, the
/// <see cref="StartMinute"/> the stint began, and the <see cref="EndMinute"/> that closes it — either
/// the start minute of the next effective stint for the same team or the match's duration minute when
/// none follows.
/// <para>
/// A <see cref="KeeperStint"/> is a pure derivation product computed by the <c>MatchEventLog</c>
/// projection from effective <c>KeeperStintStarted</c> events; the closing bound is never stored on an
/// event. <see cref="DurationMinutes"/> is the whole-minute span used to accumulate keeper time
/// (Requirement 10.5).
/// </para>
/// </summary>
/// <param name="TeamId">The working <c>MatchTeam.Id</c> being kept.</param>
/// <param name="KeeperMembershipId">The membership that kept goal for this stint.</param>
/// <param name="StartMinute">The minute of play at which the stint began.</param>
/// <param name="EndMinute">The closing bound of the stint (exclusive upper minute).</param>
public readonly record struct KeeperStint(
    Guid TeamId,
    Guid KeeperMembershipId,
    int StartMinute,
    int EndMinute)
{
    /// <summary>The whole-minute duration of the stint, measured from <see cref="StartMinute"/> to <see cref="EndMinute"/>.</summary>
    public int DurationMinutes => EndMinute - StartMinute;
}
