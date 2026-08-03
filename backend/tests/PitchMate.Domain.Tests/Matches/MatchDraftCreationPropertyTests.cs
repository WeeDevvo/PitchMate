using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Domain.Matches;

namespace PitchMate.Domain.Tests.Matches;

/// <summary>
/// Property-based tests for match draft creation (match-lifecycle design Property 1).
/// <para>
/// The property is an "iff": <see cref="Match.CreateDraft"/> succeeds exactly when the trimmed
/// location length is 1..200, the candidate-day count is 1..14, all days are distinct by instant,
/// and every day is strictly after the clock's current instant. On success the match is in
/// <see cref="MatchState.GatheringAvailability"/> with the trimmed location and exactly the supplied
/// days; on any failure a <see cref="MatchErrorCode.ValidationFailed"/> error is returned and no
/// match is produced. The two directions are covered by a success generator that satisfies every
/// rule and by four negative generators that each isolate a single violated rule. Each property
/// runs at least 100 iterations.
/// </para>
/// </summary>
[Trait("Feature", "match-lifecycle")]
public class MatchDraftCreationPropertyTests
{
    /// <summary>Non-whitespace characters used to build location cores of a controlled trimmed length.</summary>
    private static readonly char[] LocationChars =
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.!' ".TrimEnd().ToCharArray();

    // ---- Success direction ---------------------------------------------------------------------

    // Feature: match-lifecycle, Property 1: Draft creation validates and initialises correctly - a
    // valid location and a valid set of candidate days (count 1..14, distinct by instant, strictly
    // future) create a match in GatheringAvailability whose stored location is the trimmed input and
    // whose candidate days are exactly the supplied days.
    // Validates: Requirements 1.1, 1.3, 1.4, 1.5, 1.6, 2.2
    [Property(MaxTest = 100)]
    [Trait("Property", "1")]
    public Property ValidDraftIsCreatedAndInitialised() =>
        Prop.ForAll(Arb.From(ValidDraftGen()), draft =>
        {
            var result = Match.CreateDraft(Guid.Empty, Guid.NewGuid(), draft.RawLocation, draft.Days, draft.NowUtc);

            return result.IsSuccess
                && result.Value is not null
                && result.Value!.State == MatchState.GatheringAvailability
                && result.Value!.Location == draft.TrimmedLocation
                && CandidateDaysMatch(result.Value!.CandidateDays, draft.Days);
        });

    // ---- Failure direction: location policy (Requirement 1.3) ----------------------------------

    // Feature: match-lifecycle, Property 1: Draft creation validates and initialises correctly - a
    // location whose trimmed length is 0 or greater than 200, with otherwise-valid candidate days, is
    // rejected with ValidationFailed and produces no match.
    // Validates: Requirements 1.1, 1.3, 1.4, 1.5, 1.6, 2.2
    [Property(MaxTest = 100)]
    [Trait("Property", "1")]
    public Property InvalidLocationIsRejected() =>
        Prop.ForAll(Arb.From(InvalidLocationDraftGen()), sample =>
        {
            var result = Match.CreateDraft(Guid.Empty, Guid.NewGuid(), sample.Location, sample.Days, sample.NowUtc);
            return IsValidationFailureWithNoMatch(result);
        });

    // ---- Failure direction: candidate-day count policy (Requirement 1.4) -----------------------

    // Feature: match-lifecycle, Property 1: Draft creation validates and initialises correctly - a
    // candidate-day count of 0 or greater than 14, with an otherwise-valid location and distinct
    // future days, is rejected with ValidationFailed and produces no match.
    // Validates: Requirements 1.1, 1.3, 1.4, 1.5, 1.6, 2.2
    [Property(MaxTest = 100)]
    [Trait("Property", "1")]
    public Property InvalidCandidateDayCountIsRejected() =>
        Prop.ForAll(Arb.From(InvalidCountDraftGen()), sample =>
        {
            var result = Match.CreateDraft(Guid.Empty, Guid.NewGuid(), sample.Location, sample.Days, sample.NowUtc);
            return IsValidationFailureWithNoMatch(result);
        });

    // ---- Failure direction: distinctness policy (Requirement 1.5) ------------------------------

    // Feature: match-lifecycle, Property 1: Draft creation validates and initialises correctly - a
    // candidate-day list (count within 2..14, all strictly future) that contains two days resolving
    // to the same instant is rejected with ValidationFailed and produces no match.
    // Validates: Requirements 1.1, 1.3, 1.4, 1.5, 1.6, 2.2
    [Property(MaxTest = 100)]
    [Trait("Property", "1")]
    public Property NonDistinctCandidateDaysAreRejected() =>
        Prop.ForAll(Arb.From(ValidLocationGen()), Arb.From(NonDistinctDaysGen()), (location, sample) =>
        {
            var result = Match.CreateDraft(Guid.Empty, Guid.NewGuid(), location, sample.Days, sample.NowUtc);
            return IsValidationFailureWithNoMatch(result);
        });

    // ---- Failure direction: future-dating policy (Requirement 1.6) -----------------------------

    // Feature: match-lifecycle, Property 1: Draft creation validates and initialises correctly - a
    // candidate-day list (distinct, count within range) that includes at least one day at or before
    // the clock's current instant is rejected with ValidationFailed and produces no match.
    // Validates: Requirements 1.1, 1.3, 1.4, 1.5, 1.6, 2.2
    [Property(MaxTest = 100)]
    [Trait("Property", "1")]
    public Property NonFutureCandidateDaysAreRejected() =>
        Prop.ForAll(Arb.From(ValidLocationGen()), Arb.From(NonFutureDaysGen()), (location, sample) =>
        {
            var result = Match.CreateDraft(Guid.Empty, Guid.NewGuid(), location, sample.Days, sample.NowUtc);
            return IsValidationFailureWithNoMatch(result);
        });

    // ---- Assertions helpers --------------------------------------------------------------------

    /// <summary>A failure is a ValidationFailed error that produced no match value.</summary>
    private static bool IsValidationFailureWithNoMatch(Result<Match> result) =>
        !result.IsSuccess
        && result.Value is null
        && result.Error!.Code == MatchErrorCode.ValidationFailed;

    /// <summary>
    /// The stored candidate days equal exactly the supplied days: same count and same set by instant
    /// (a valid input list is distinct, so the counts must match).
    /// </summary>
    private static bool CandidateDaysMatch(IReadOnlyCollection<CandidateDay> stored, IReadOnlyList<DateTimeOffset> supplied)
    {
        var expected = supplied.Select(d => new CandidateDay(d)).ToHashSet();
        return stored.Count == supplied.Count
            && stored.Count == expected.Count
            && stored.All(expected.Contains);
    }

    // ---- Generators: clock -----------------------------------------------------------------------

    /// <summary>A "current instant" anchored to a fixed base plus a random offset, kept well clear of overflow.</summary>
    private static Gen<DateTimeOffset> NowGen() =>
        from days in Gen.Choose(0, 3650)
        from minutes in Gen.Choose(0, 1439)
        select new DateTimeOffset(2025, 1, 1, 0, 0, 0, TimeSpan.Zero).AddDays(days).AddMinutes(minutes);

    // ---- Generators: locations -------------------------------------------------------------------

    /// <summary>A raw (possibly whitespace-padded) location and the trimmed value it must produce.</summary>
    private sealed record PaddedLocation(string Raw, string Trimmed);

    /// <summary>Generates a valid location whose trimmed length is 1..200, optionally whitespace-padded.</summary>
    private static Gen<PaddedLocation> PaddedLocationGen() =>
        from core in LocationCoreGen(Match.LocationMinLength, Match.LocationMaxLength)
        from lead in WhitespaceGen()
        from trail in WhitespaceGen()
        select new PaddedLocation(lead + core + trail, core);

    /// <summary>Generates just the raw form of a valid location (for tests that ignore the trimmed value).</summary>
    private static Gen<string> ValidLocationGen() =>
        from padded in PaddedLocationGen()
        select padded.Raw;

    /// <summary>Generates an invalid location: trimmed length 0 (whitespace-only) or greater than 200.</summary>
    private static Gen<string> InvalidLocationGen() =>
        Gen.OneOf(WhitespaceGen(), TooLongLocationGen());

    /// <summary>Generates a non-empty core of <paramref name="min"/>..<paramref name="max"/> non-whitespace characters.</summary>
    private static Gen<string> LocationCoreGen(int min, int max) =>
        from length in Gen.Choose(min, max)
        from chars in Gen.ArrayOf(Gen.Elements(LocationChars), length)
        select new string(chars);

    /// <summary>Generates a location whose trimmed length exceeds 200 characters.</summary>
    private static Gen<string> TooLongLocationGen() =>
        from extra in Gen.Choose(1, 100)
        from chars in Gen.ArrayOf(Gen.Elements(LocationChars), Match.LocationMaxLength + extra)
        select new string(chars);

    /// <summary>Generates a possibly-empty run of whitespace characters (trimmed length 0).</summary>
    private static Gen<string> WhitespaceGen() =>
        from chars in Gen.ListOf(Gen.Elements(' ', '\t', '\n'))
        select new string(chars.ToArray());

    // ---- Generators: candidate days --------------------------------------------------------------

    /// <summary>A generated set of candidate days paired with the clock instant they were generated against.</summary>
    private sealed record DaySample(DateTimeOffset NowUtc, DateTimeOffset[] Days);

    /// <summary>A full valid draft: raw + trimmed location, the clock instant, and valid candidate days.</summary>
    private sealed record ValidDraft(string RawLocation, string TrimmedLocation, DateTimeOffset NowUtc, DateTimeOffset[] Days);

    /// <summary>Generates a valid draft satisfying every rule (valid location, 1..14 distinct future days).</summary>
    private static Gen<ValidDraft> ValidDraftGen() =>
        from now in NowGen()
        from location in PaddedLocationGen()
        from days in ValidDaysGen(now)
        select new ValidDraft(location.Raw, location.Trimmed, now, days);

    /// <summary>Generates 1..14 distinct, strictly-future candidate days relative to <paramref name="now"/>.</summary>
    private static Gen<DateTimeOffset[]> ValidDaysGen(DateTimeOffset now) =>
        from count in Gen.Choose(Match.CandidateDayMinCount, Match.CandidateDayMaxCount)
        from gaps in Gen.ArrayOf(Gen.Choose(1, 500), count)
        select StrictlyIncreasingFuture(now, gaps);

    /// <summary>A clock instant, a location, and a candidate-day list, generated together for a negative case.</summary>
    private sealed record LocationDraftSample(DateTimeOffset NowUtc, string Location, DateTimeOffset[] Days);

    /// <summary>Generates a draft with an invalid location (trimmed length 0 or &gt; 200) but valid candidate days.</summary>
    private static Gen<LocationDraftSample> InvalidLocationDraftGen() =>
        from now in NowGen()
        from location in InvalidLocationGen()
        from days in ValidDaysGen(now)
        select new LocationDraftSample(now, location, days);

    /// <summary>Generates a draft with a valid location but an invalid candidate-day count (0, or &gt; 14).</summary>
    private static Gen<LocationDraftSample> InvalidCountDraftGen() =>
        from now in NowGen()
        from location in ValidLocationGen()
        from days in InvalidCountDaysGen(now)
        select new LocationDraftSample(now, location, days);

    /// <summary>Generates an invalid candidate-day count: zero days, or more than 14 distinct future days.</summary>
    private static Gen<DateTimeOffset[]> InvalidCountDaysGen(DateTimeOffset now) =>
        Gen.OneOf(
            Gen.Constant(Array.Empty<DateTimeOffset>()),
            from count in Gen.Choose(Match.CandidateDayMaxCount + 1, Match.CandidateDayMaxCount + 6)
            from gaps in Gen.ArrayOf(Gen.Choose(1, 500), count)
            select StrictlyIncreasingFuture(now, gaps));

    /// <summary>
    /// Generates a candidate-day list (count 2..14, all future) that contains a duplicate instant:
    /// a distinct future base of size 1..13 with one of its days repeated.
    /// </summary>
    private static Gen<DaySample> NonDistinctDaysGen() =>
        from now in NowGen()
        from k in Gen.Choose(1, Match.CandidateDayMaxCount - 1)
        from gaps in Gen.ArrayOf(Gen.Choose(1, 500), k)
        from dupIndex in Gen.Choose(0, k - 1)
        select WithDuplicate(now, gaps, dupIndex);

    /// <summary>
    /// Generates a distinct candidate-day list (count 1..14) that includes at least one day at or
    /// before <paramref name="now"/>: some strictly-future days combined with some non-future days.
    /// </summary>
    private static Gen<DaySample> NonFutureDaysGen() =>
        from now in NowGen()
        from futureCount in Gen.Choose(0, 7)
        from nonFutureCount in Gen.Choose(1, 7)
        from futureGaps in Gen.ArrayOf(Gen.Choose(1, 500), futureCount)
        from nonFutureGaps in Gen.ArrayOf(Gen.Choose(1, 500), nonFutureCount)
        select CombineFutureAndNonFuture(now, futureGaps, nonFutureGaps);

    // ---- Day-building helpers --------------------------------------------------------------------

    /// <summary>Builds strictly-increasing future days from positive gaps (distinct, all after <paramref name="now"/>).</summary>
    private static DateTimeOffset[] StrictlyIncreasingFuture(DateTimeOffset now, int[] gaps)
    {
        var days = new DateTimeOffset[gaps.Length];
        long acc = 0;
        for (var i = 0; i < gaps.Length; i++)
        {
            acc += gaps[i]; // gaps >= 1, so acc is strictly increasing and positive
            days[i] = now.AddMinutes(acc);
        }

        return days;
    }

    /// <summary>Builds a distinct future base and appends a copy of one of its days to force a duplicate instant.</summary>
    private static DaySample WithDuplicate(DateTimeOffset now, int[] gaps, int dupIndex)
    {
        var baseDays = StrictlyIncreasingFuture(now, gaps);
        var days = new DateTimeOffset[baseDays.Length + 1];
        Array.Copy(baseDays, days, baseDays.Length);
        days[^1] = baseDays[dupIndex];
        return new DaySample(now, days);
    }

    /// <summary>
    /// Combines strictly-future days (positive offsets) with non-future days (offset 0 then strictly
    /// decreasing negatives). The two ranges never collide, so the whole list is distinct while
    /// guaranteeing at least one day at or before <paramref name="now"/>.
    /// </summary>
    private static DaySample CombineFutureAndNonFuture(DateTimeOffset now, int[] futureGaps, int[] nonFutureGaps)
    {
        var future = StrictlyIncreasingFuture(now, futureGaps);

        var nonFuture = new DateTimeOffset[nonFutureGaps.Length];
        long acc = 0;
        for (var i = 0; i < nonFutureGaps.Length; i++)
        {
            nonFuture[i] = now.AddMinutes(acc); // first is 0 (== now, non-future), then strictly negative
            acc -= nonFutureGaps[i];
        }

        return new DaySample(now, [.. future, .. nonFuture]);
    }
}
