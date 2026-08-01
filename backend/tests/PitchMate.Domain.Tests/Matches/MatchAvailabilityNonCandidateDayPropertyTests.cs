using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Domain.Matches;

namespace PitchMate.Domain.Tests.Matches;

/// <summary>
/// Property-based tests for non-candidate-day rejection of availability responses
/// (match-lifecycle design Property 5).
/// <para>
/// The property: for any availability submission that references one or more days that are not
/// candidate days of the match, <see cref="Match.SubmitAvailability"/> rejects the submission with a
/// <see cref="MatchErrorCode.ValidationFailed"/> error that identifies each offending day, and leaves
/// the member's stored response unchanged. This is exercised against a genuine "mix": each generated
/// submission combines a non-empty subset of the match's real candidate days with one or more days
/// that are provably not candidate days (built from a disjoint offset region so they never collide by
/// instant with any candidate day). A prior, valid response is stored first so the "left unchanged"
/// guarantee is asserted against a concrete pre-existing response rather than against nothing. The
/// property runs at least 100 iterations.
/// </para>
/// </summary>
[Trait("Feature", "match-lifecycle")]
public class MatchAvailabilityNonCandidateDayPropertyTests
{
    /// <summary>A fixed responding membership; its exact value is irrelevant to the property.</summary>
    private static readonly Guid MembershipId = Guid.Parse("11111111-1111-1111-1111-111111111111");

    // Feature: match-lifecycle, Property 5: Availability responses referencing non-candidate days are
    // rejected - for any submission referencing one or more days that are not candidate days of the
    // match, the submission is rejected with a validation error identifying each offending day and the
    // member's stored response is left unchanged.
    // Validates: Requirements 4.4
    [Property(MaxTest = 100)]
    [Trait("Property", "5")]
    public Property SubmissionReferencingNonCandidateDaysIsRejectedAndLeavesStoredResponseUnchanged() =>
        Prop.ForAll(Arb.From(SampleGen()), sample =>
        {
            var draft = Match.CreateDraft(
                Guid.Empty,
                Guid.NewGuid(),
                "Central Pitch",
                sample.CandidateDays,
                sample.Now);
            var match = draft.Value ?? throw new InvalidOperationException("Draft creation failed unexpectedly.");

            // Establish a concrete, valid prior response for the member.
            var prior = match.SubmitAvailability(MembershipId, sample.PriorMarkedDays, sample.PriorSubmittedAt);
            if (!prior.IsSuccess)
            {
                return false; // The prior response is valid by construction; a failure means a broken generator.
            }

            var priorMarked = ToInstantSet(match.GetAvailabilityResponse(MembershipId)!.MarkedDays);

            // Attempt the invalid submission mixing real candidate days with non-candidate days.
            var result = match.SubmitAvailability(MembershipId, sample.Submission, sample.InvalidSubmittedAt);

            var message = result.Error?.Message ?? string.Empty;
            var everyOffendingDayNamed = sample.OffendingDays.All(day =>
                message.Contains(day.ToUniversalTime().ToString("O"), StringComparison.Ordinal));

            var stored = match.GetAvailabilityResponse(MembershipId);
            var storedUnchanged =
                stored is not null
                && stored.SubmittedAt == sample.PriorSubmittedAt
                && ToInstantSet(stored.MarkedDays).SetEquals(priorMarked);

            return !result.IsSuccess
                && result.Error!.Code == MatchErrorCode.ValidationFailed
                && everyOffendingDayNamed
                && storedUnchanged;
        });

    /// <summary>Projects a set of candidate days to their underlying UTC instants for set comparison.</summary>
    private static HashSet<DateTimeOffset> ToInstantSet(IEnumerable<CandidateDay> days) =>
        days.Select(d => d.Instant).ToHashSet();

    // ---- Generators -----------------------------------------------------------------------------

    /// <summary>A generated scenario: candidate days, a valid prior response, and an invalid mixed submission.</summary>
    private sealed record Sample(
        DateTimeOffset Now,
        DateTimeOffset[] CandidateDays,
        DateTimeOffset[] PriorMarkedDays,
        DateTimeOffset[] Submission,
        DateTimeOffset[] OffendingDays,
        DateTimeOffset PriorSubmittedAt,
        DateTimeOffset InvalidSubmittedAt);

    /// <summary>
    /// Generates a match's candidate days (1..14 distinct future days), a prior response over an
    /// arbitrary subset of them, and an invalid submission that mixes a non-empty subset of candidate
    /// days with 1..5 non-candidate days drawn from a disjoint offset region.
    /// </summary>
    private static Gen<Sample> SampleGen() =>
        from now in NowGen()
        from candidateGaps in GapsGen(Match.CandidateDayMinCount, Match.CandidateDayMaxCount)
        from priorFlags in Gen.ArrayOf(Gen.Elements(true, false), candidateGaps.Length)
        from validFlags in Gen.ArrayOf(Gen.Elements(true, false), candidateGaps.Length)
        from offendingGaps in GapsGen(1, 5)
        select Build(now, candidateGaps, priorFlags, validFlags, offendingGaps);

    /// <summary>Generates an array of <paramref name="min"/>..<paramref name="max"/> positive minute gaps.</summary>
    private static Gen<int[]> GapsGen(int min, int max) =>
        from count in Gen.Choose(min, max)
        from gaps in Gen.ArrayOf(Gen.Choose(1, 500), count)
        select gaps;

    /// <summary>A "current instant" anchored to a fixed base plus a random offset, well clear of overflow.</summary>
    private static Gen<DateTimeOffset> NowGen() =>
        from days in Gen.Choose(0, 3650)
        from minutes in Gen.Choose(0, 1439)
        select new DateTimeOffset(2025, 1, 1, 0, 0, 0, TimeSpan.Zero).AddDays(days).AddMinutes(minutes);

    /// <summary>
    /// Materialises a scenario. Candidate days occupy minute offsets 1..sum(candidateGaps) after
    /// <paramref name="now"/>; the offending days start strictly beyond the largest candidate offset,
    /// so they are guaranteed distinct from every candidate day by instant. The invalid submission is a
    /// non-empty subset of candidate days followed by the offending days.
    /// </summary>
    private static Sample Build(
        DateTimeOffset now,
        int[] candidateGaps,
        bool[] priorFlags,
        bool[] validFlags,
        int[] offendingGaps)
    {
        var candidateDays = Accumulate(now, candidateGaps, startOffset: 0);
        var maxCandidateOffset = candidateGaps.Sum();
        var offendingDays = Accumulate(now, offendingGaps, startOffset: maxCandidateOffset);

        var priorMarked = candidateDays.Where((_, i) => priorFlags[i]).ToArray();

        var validPart = candidateDays.Where((_, i) => validFlags[i]).ToArray();
        if (validPart.Length == 0)
        {
            validPart = [candidateDays[0]]; // ensure a genuine mix of at least one real candidate day
        }

        var submission = validPart.Concat(offendingDays).ToArray();

        return new Sample(
            now,
            candidateDays,
            priorMarked,
            submission,
            offendingDays,
            PriorSubmittedAt: now,
            InvalidSubmittedAt: now.AddDays(1));
    }

    /// <summary>Builds strictly-increasing UTC days from positive gaps, starting after <paramref name="startOffset"/> minutes.</summary>
    private static DateTimeOffset[] Accumulate(DateTimeOffset now, int[] gaps, int startOffset)
    {
        var days = new DateTimeOffset[gaps.Length];
        long acc = startOffset;
        for (var i = 0; i < gaps.Length; i++)
        {
            acc += gaps[i]; // gaps >= 1, so offsets are strictly increasing and > startOffset
            days[i] = now.AddMinutes(acc);
        }

        return days;
    }
}
