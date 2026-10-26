using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Domain.Matches;

namespace PitchMate.Domain.Tests.Matches;

/// <summary>
/// Property-based tests for match confirmation and participant seeding (match-lifecycle design
/// Property 8, revised when availability became a guide rather than a gate).
/// <para>
/// <see cref="Match.Confirm"/> succeeds exactly when the requested day resolves to one of the match's
/// candidate days, however few marked it (Requirement 6.1, 6.4). On success the confirmed day becomes
/// the <see cref="Match.ConfirmedDay"/>, the state becomes <see cref="MatchState.Confirmed"/>, and the
/// participant set equals exactly the active members, registered or guest (deduplicated by membership
/// id), whose stored availability response marks the confirmed day (Requirement 6.5). On failure the
/// match remains in <see cref="MatchState.GatheringAvailability"/> with no confirmed day and no
/// participants.
/// </para>
/// <para>
/// The test drives the behaviour end-to-end through the <see cref="Match"/> aggregate: candidate days
/// come from <see cref="Match.CreateDraft"/>, stored responses are submitted via
/// <see cref="Match.SubmitAvailability"/>, and confirm days are generated as both candidate and
/// non-candidate days. An independent oracle over the same generated data is compared against the
/// aggregate's outcome. The property runs at least 100 iterations.
/// </para>
/// </summary>
[Trait("Feature", "match-lifecycle")]
public class MatchConfirmationPropertyTests
{
    /// <summary>The clock instant the generated matches are drafted against; candidate days are strictly after it.</summary>
    private static readonly DateTimeOffset NowUtc = new(2025, 1, 1, 0, 0, 0, TimeSpan.Zero);

    // Feature: match-lifecycle, Property 8: Confirmation on any candidate day seeds who marked it -
    // for any match in GatheringAvailability, Confirm succeeds iff the day is a candidate day, whatever
    // its count; on success the day becomes the ConfirmedDay, the state becomes Confirmed, and the
    // participant set equals exactly the active members (guests included, each keeping its guest flag)
    // whose response marks the confirmed day; on failure the match remains in GatheringAvailability
    // with no confirmed day and no participants.
    // Validates: Requirements 6.1, 6.4, 6.5
    [Property(MaxTest = 100)]
    [Trait("Property", "8")]
    public Property ConfirmationOnAnyCandidateDaySeedsWhoMarkedIt() =>
        Prop.ForAll(Arb.From(ScenarioGen()), scenario =>
        {
            var match = Match.CreateDraft(
                Guid.Empty,
                Guid.NewGuid(),
                "Community Astro Pitch",
                scenario.CandidateDays,
                NowUtc).Value!;

            // Seed each member's stored availability response through the aggregate. Every marked day
            // is a candidate day, so submission must succeed.
            for (var i = 0; i < scenario.Members.Length; i++)
            {
                var member = scenario.Members[i];
                if (!member.HasResponse)
                {
                    continue;
                }

                var markedDays = member.MarkedDayIndices.Select(idx => scenario.CandidateDays[idx]).ToList();
                var submit = match.SubmitAvailability(member.Id, markedDays, NowUtc.AddMinutes(i + 1));
                if (!submit.IsSuccess)
                {
                    return false;
                }
            }

            // A confirm-day index of -1 exercises the non-candidate branch of the day gate.
            var dayIsCandidate = scenario.ConfirmDayIndex >= 0;
            var confirmDay = dayIsCandidate
                ? scenario.CandidateDays[scenario.ConfirmDayIndex]
                : NonCandidateDay(scenario.CandidateDays.Length);

            // The aggregate seeds from exactly this set; eligibility scoping is the caller's concern.
            var activeMembers = scenario.Members
                .Select(m => new ConfirmableMember(m.Id, m.DisplayName, m.IsGuest))
                .ToList();

            var result = match.Confirm(
                confirmDay,
                activeMembers);

            if (dayIsCandidate)
            {
                // Oracle: exactly the members whose stored response marks the confirmed candidate day.
                var expectedParticipantIds = scenario.Members
                    .Where(m => m.HasResponse && m.MarkedDayIndices.Contains(scenario.ConfirmDayIndex))
                    .Select(m => m.Id)
                    .ToHashSet();

                var actualParticipantIds = match.Participants.Select(p => p.SquadMembershipId).ToHashSet();

                return result.IsSuccess
                    && match.State == MatchState.Confirmed
                    && match.ConfirmedDay is not null
                    && match.ConfirmedDay.Value.Equals(new CandidateDay(confirmDay))
                    && actualParticipantIds.SetEquals(expectedParticipantIds)
                    && match.Participants.Count == actualParticipantIds.Count   // no duplicate participant
                    && match.Participants.All(p =>                              // each keeps its guest flag
                        p.IsGuest == scenario.Members.First(m => m.Id == p.SquadMembershipId).IsGuest);
            }

            // Failure path: only a non-candidate day is refused.
            return !result.IsSuccess
                && result.Error!.Code == MatchErrorCode.ValidationFailed
                && match.State == MatchState.GatheringAvailability
                && match.ConfirmedDay is null
                && match.Participants.Count == 0;
        });

    /// <summary>A day strictly after every candidate day, guaranteed not to be one of them.</summary>
    private static DateTimeOffset NonCandidateDay(int dayCount) => NowUtc.AddDays(dayCount + 100);

    // ---- Generators -----------------------------------------------------------------------------

    /// <summary>A generated member: identity, display name, guest or registered, and its (optional) stored response subset.</summary>
    private sealed record MemberSpec(Guid Id, string DisplayName, bool IsGuest, bool HasResponse, int[] MarkedDayIndices);

    /// <summary>A generated confirmation scenario over a drafted match's candidate days and member pool.</summary>
    private sealed record ConfirmScenario(
        DateTimeOffset[] CandidateDays,
        MemberSpec[] Members,
        int ConfirmDayIndex);

    /// <summary>
    /// Generates a scenario with 1..8 distinct future candidate days, a pool of 0..10 members (some with
    /// a stored response marking a random subset of days, some with none), a confirm-day index that is
    /// either a valid candidate index or -1 (a non-candidate day), so the day gate is exercised in both
    /// directions.
    /// </summary>
    private static Gen<ConfirmScenario> ScenarioGen() =>
        from dayCount in Gen.Choose(1, 8)
        from memberCount in Gen.Choose(0, 10)
        from members in MembersGen(memberCount, dayCount)
        from confirmDayIndex in Gen.Choose(-1, dayCount - 1)
        select new ConfirmScenario(
            BuildCandidateDays(dayCount),
            members,
            confirmDayIndex);

    /// <summary>Generates a pool of <paramref name="memberCount"/> members with distinct identities.</summary>
    private static Gen<MemberSpec[]> MembersGen(int memberCount, int dayCount) =>
        from specs in Gen.ArrayOf(ResponseSpecGen(dayCount), memberCount)
        select specs
            .Select((spec, i) => new MemberSpec(Guid.NewGuid(), $"Member {i}", spec.IsGuest, spec.HasResponse, spec.MarkedDayIndices))
            .ToArray();

    /// <summary>Generates one member's profile: guest or registered, whether it has a response and, if so, which days it marks.</summary>
    private static Gen<(bool IsGuest, bool HasResponse, int[] MarkedDayIndices)> ResponseSpecGen(int dayCount) =>
        from isGuest in Gen.Elements(true, false)
        from hasResponse in Gen.Elements(true, false)
        from mask in Gen.ArrayOf(Gen.Elements(true, false), dayCount)
        select (isGuest, hasResponse, DayIndicesFromMask(mask));

    /// <summary>The day indices selected by <paramref name="mask"/> (those positions set to <see langword="true"/>).</summary>
    private static int[] DayIndicesFromMask(bool[] mask) =>
        [.. Enumerable.Range(0, mask.Length).Where(i => mask[i])];

    /// <summary>Builds <paramref name="dayCount"/> strictly-future, distinct candidate days (one per day).</summary>
    private static DateTimeOffset[] BuildCandidateDays(int dayCount) =>
        [.. Enumerable.Range(1, dayCount).Select(i => NowUtc.AddDays(i))];
}
