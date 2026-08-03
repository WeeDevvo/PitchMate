using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Domain.Matches;

namespace PitchMate.Domain.Tests.Matches;

/// <summary>
/// Property-based tests for the availability tally computation (match-lifecycle design Property 7).
/// <para>
/// For any set of members and their submitted availability responses — including resubmissions —
/// the tally computed for a match reports, for every candidate day, exactly the count and identities
/// of the members whose <em>single most recent</em> response marks that day, excluding members with
/// no stored response and members whose latest response does not mark the day (Requirement 5.1, 5.2,
/// 5.3, 5.4). The test drives the behaviour end-to-end through the <see cref="Match"/> aggregate:
/// responses are submitted via <see cref="Match.SubmitAvailability"/> (with resubmissions replacing
/// a member's prior response) and the tally is read via <see cref="Match.ComputeAvailabilityTally"/>.
/// Because each member's submissions are made in strictly increasing submission-time order, the last
/// submission is that member's most recent response, and an independent oracle over the same
/// submissions is compared against the tally. The property runs at least 100 iterations.
/// </para>
/// </summary>
[Trait("Feature", "match-lifecycle")]
public class AvailabilityTallyPropertyTests
{
    /// <summary>The clock instant the generated matches are drafted against; candidate days are strictly after it.</summary>
    private static readonly DateTimeOffset NowUtc = new(2025, 1, 1, 0, 0, 0, TimeSpan.Zero);

    // Feature: match-lifecycle, Property 7: The availability tally counts each day's latest-response
    // markers - for any set of members and their submitted responses (including resubmissions), the
    // tally for each candidate day reports exactly the count and identities of the active registered
    // members whose single most recent response marks that day, excluding members with no response and
    // members whose latest response does not mark the day.
    // Validates: Requirements 5.1, 5.2, 5.3, 5.4
    [Property(MaxTest = 100)]
    [Trait("Property", "7")]
    public Property TallyCountsEachDaysLatestResponseMarkers() =>
        Prop.ForAll(Arb.From(ScenarioGen()), scenario =>
        {
            var match = Match.CreateDraft(
                Guid.Empty,
                Guid.NewGuid(),
                "Community Astro Pitch",
                scenario.CandidateDays,
                NowUtc).Value!;

            // Replay every submission through the aggregate in strictly increasing submission-time
            // order, so each member's last submission is their most recent response. The oracle records
            // that member's latest marked-day set (by index), mirroring the aggregate's upsert.
            var latestMarkedByMember = new Dictionary<int, HashSet<int>>();
            for (var i = 0; i < scenario.Submissions.Length; i++)
            {
                var submission = scenario.Submissions[i];
                var memberId = scenario.MemberIds[submission.MemberIndex];
                var markedDays = submission.DayIndices.Select(idx => scenario.CandidateDays[idx]).ToList();

                var submit = match.SubmitAvailability(memberId, markedDays, NowUtc.AddMinutes(i + 1));
                if (!submit.IsSuccess)
                {
                    return false; // every marked day is a candidate day, so submission must succeed
                }

                latestMarkedByMember[submission.MemberIndex] = [.. submission.DayIndices];
            }

            var tally = match.ComputeAvailabilityTally();

            // Every candidate day is represented exactly once, in the match's candidate-day order.
            if (tally.Days.Count != scenario.CandidateDays.Length)
            {
                return false;
            }

            for (var dayIndex = 0; dayIndex < scenario.CandidateDays.Length; dayIndex++)
            {
                var entry = tally.Days[dayIndex];
                if (!entry.Day.Equals(new CandidateDay(scenario.CandidateDays[dayIndex])))
                {
                    return false;
                }

                // Oracle: the members whose latest response marks this day. Members with no stored
                // response are absent from the dictionary and so are excluded (Requirement 5.4).
                var expectedMemberIds = latestMarkedByMember
                    .Where(kvp => kvp.Value.Contains(dayIndex))
                    .Select(kvp => scenario.MemberIds[kvp.Key])
                    .ToHashSet();

                var actualMemberIds = entry.AvailableMemberIds.ToHashSet();

                var identitiesMatch = actualMemberIds.SetEquals(expectedMemberIds);
                var noDuplicateIdentities = entry.AvailableMemberIds.Count == actualMemberIds.Count;
                var countMatchesSetSize = entry.Count == entry.AvailableMemberIds.Count;
                var countMatchesExpected = entry.Count == expectedMemberIds.Count;

                if (!(identitiesMatch && noDuplicateIdentities && countMatchesSetSize && countMatchesExpected))
                {
                    return false;
                }
            }

            return true;
        });

    // ---- Generators -----------------------------------------------------------------------------

    /// <summary>A single submission: which member submitted and which candidate-day indices it marks.</summary>
    private sealed record RawSubmission(int MemberIndex, int[] DayIndices);

    /// <summary>A generated tally scenario: the match's candidate days, its member pool, and the ordered submissions.</summary>
    private sealed record TallyScenario(DateTimeOffset[] CandidateDays, Guid[] MemberIds, RawSubmission[] Submissions);

    /// <summary>
    /// Generates a scenario with 1..8 distinct future candidate days, a pool of 0..10 members, and an
    /// ordered sequence of submissions (possibly several per member, exercising resubmission). A member
    /// pool larger than the members who actually submit exercises the "no response" exclusion.
    /// </summary>
    private static Gen<TallyScenario> ScenarioGen() =>
        from dayCount in Gen.Choose(1, 8)
        from memberCount in Gen.Choose(0, 10)
        from submissions in SubmissionsGen(memberCount, dayCount)
        select new TallyScenario(BuildCandidateDays(dayCount), BuildMemberIds(memberCount), submissions);

    /// <summary>
    /// Generates 0..20 submissions over <paramref name="memberCount"/> members and
    /// <paramref name="dayCount"/> candidate days; with no members there can be no submissions.
    /// </summary>
    private static Gen<RawSubmission[]> SubmissionsGen(int memberCount, int dayCount)
    {
        if (memberCount == 0)
        {
            return Gen.Constant(Array.Empty<RawSubmission>());
        }

        return from count in Gen.Choose(0, 20)
               from submissions in Gen.ArrayOf(SingleSubmissionGen(memberCount, dayCount), count)
               select submissions;
    }

    /// <summary>Generates one submission: a random member and a random (possibly empty) subset of candidate days.</summary>
    private static Gen<RawSubmission> SingleSubmissionGen(int memberCount, int dayCount) =>
        from memberIndex in Gen.Choose(0, memberCount - 1)
        from mask in Gen.ArrayOf(Gen.Elements(true, false), dayCount)
        select new RawSubmission(memberIndex, DayIndicesFromMask(mask));

    /// <summary>The day indices selected by <paramref name="mask"/> (those positions set to <see langword="true"/>).</summary>
    private static int[] DayIndicesFromMask(bool[] mask) =>
        [.. Enumerable.Range(0, mask.Length).Where(i => mask[i])];

    /// <summary>Builds <paramref name="dayCount"/> strictly-future, distinct candidate days (one per day).</summary>
    private static DateTimeOffset[] BuildCandidateDays(int dayCount) =>
        [.. Enumerable.Range(1, dayCount).Select(i => NowUtc.AddDays(i))];

    /// <summary>Builds a pool of <paramref name="memberCount"/> distinct membership identities.</summary>
    private static Guid[] BuildMemberIds(int memberCount) =>
        [.. Enumerable.Range(0, memberCount).Select(_ => Guid.NewGuid())];
}
