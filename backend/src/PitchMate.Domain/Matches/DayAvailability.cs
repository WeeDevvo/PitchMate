namespace PitchMate.Domain.Matches;

/// <summary>
/// One candidate day's entry in an <see cref="AvailabilityTally"/>: the day itself together with the
/// identities of the active registered members whose single most recent availability response marks
/// that day as available (Requirement 5.1). The <see cref="Count"/> is derived from
/// <see cref="AvailableMemberIds"/>, so a day marked by nobody reports a count of 0 and an empty set
/// (Requirement 5.2). Members with no response, and members whose latest response does not mark the
/// day, are absent from <see cref="AvailableMemberIds"/> (Requirement 5.4).
/// </summary>
/// <remarks>
/// This is a pure Domain value with no persistence identity. Membership-eligibility filtering (active,
/// registered) is the caller's concern: this entry reflects exactly the responses it was computed from.
/// </remarks>
public sealed class DayAvailability
{
    private readonly List<Guid> _availableMemberIds;

    /// <summary>
    /// Creates the entry for <paramref name="day"/> from the resolved set of
    /// <paramref name="availableMemberIds"/>. Called only by <see cref="AvailabilityTally.Compute"/>.
    /// </summary>
    /// <param name="day">The candidate day this entry describes.</param>
    /// <param name="availableMemberIds">The identities of the members available on <paramref name="day"/>; may be empty.</param>
    internal DayAvailability(CandidateDay day, IEnumerable<Guid> availableMemberIds)
    {
        Day = day;
        _availableMemberIds = [.. availableMemberIds];
    }

    /// <summary>The candidate day this entry describes.</summary>
    public CandidateDay Day { get; }

    /// <summary>
    /// The identities of the active registered members available on <see cref="Day"/>, each appearing
    /// at most once. Empty when no member's latest response marks the day (Requirement 5.2).
    /// </summary>
    public IReadOnlyCollection<Guid> AvailableMemberIds => _availableMemberIds;

    /// <summary>The number of members available on <see cref="Day"/>, equal to <see cref="AvailableMemberIds"/>'s size.</summary>
    public int Count => _availableMemberIds.Count;
}
