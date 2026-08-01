namespace PitchMate.Domain.Matches;

/// <summary>
/// The per-candidate-day availability summary for a match: for each candidate day, the count and
/// identities of the members whose single most recent availability response marks that day as
/// available (Requirement 5.1). Every candidate day of the match is represented, including days no
/// member marked, which report a count of 0 and an empty member set (Requirement 5.2).
/// <para>
/// The tally is a pure Domain computation over a supplied set of responses (see
/// <see cref="Compute"/>). It does not itself filter by membership eligibility: the caller supplies
/// exactly the responses of the active registered members it wishes to count, keeping this
/// computation free of squad-membership concerns (mirroring how authorisation is left to the
/// Application layer). Determining a member's <em>single most recent</em> response by submission time
/// is handled here so the tally is robust even when handed several responses for one member
/// (Requirement 5.3).
/// </para>
/// </summary>
public sealed class AvailabilityTally
{
    private readonly List<DayAvailability> _days;

    private AvailabilityTally(IEnumerable<DayAvailability> days) => _days = [.. days];

    /// <summary>The per-candidate-day entries, one for every candidate day supplied to <see cref="Compute"/>.</summary>
    public IReadOnlyList<DayAvailability> Days => _days;

    /// <summary>
    /// Computes the availability tally for <paramref name="candidateDays"/> from
    /// <paramref name="responses"/>. For each candidate day, the result reports the identities (and
    /// therefore the count) of the members whose most recent response marks that day (Requirement 5.1,
    /// 5.2). When <paramref name="responses"/> contains more than one response for the same member,
    /// only that member's response with the greatest <see cref="AvailabilityResponse.SubmittedAt"/> is
    /// counted, and on equal submission instants the last-supplied response wins (Requirement 5.3). A
    /// member with no response, and a member whose latest response does not mark a day, are excluded
    /// from that day's entry (Requirement 5.4).
    /// </summary>
    /// <param name="candidateDays">The match's candidate days; every one produces an entry, even if marked by no member.</param>
    /// <param name="responses">The availability responses to tally; should already be scoped to the active registered members the caller wishes to count.</param>
    /// <returns>An <see cref="AvailabilityTally"/> with one <see cref="DayAvailability"/> per supplied candidate day.</returns>
    public static AvailabilityTally Compute(
        IEnumerable<CandidateDay> candidateDays,
        IEnumerable<AvailabilityResponse> responses)
    {
        ArgumentNullException.ThrowIfNull(candidateDays);
        ArgumentNullException.ThrowIfNull(responses);

        // Reduce to each member's single most recent response, resolved by submission time.
        var latestByMember = new Dictionary<Guid, AvailabilityResponse>();
        foreach (var response in responses)
        {
            if (!latestByMember.TryGetValue(response.SquadMembershipId, out var existing)
                || response.SubmittedAt >= existing.SubmittedAt)
            {
                latestByMember[response.SquadMembershipId] = response;
            }
        }

        var days = new List<DayAvailability>();
        foreach (var day in candidateDays)
        {
            var availableMemberIds = latestByMember.Values
                .Where(response => response.Marks(day))
                .Select(response => response.SquadMembershipId);
            days.Add(new DayAvailability(day, availableMemberIds));
        }

        return new AvailabilityTally(days);
    }
}
