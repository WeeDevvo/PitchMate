using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Domain.Matches;

namespace PitchMate.Domain.Tests.Matches;

/// <summary>
/// Property-based tests for availability-response storage semantics (match-lifecycle design
/// Property 4).
/// <para>
/// For any match in <see cref="MatchState.GatheringAvailability"/> and any sequence of submit/clear
/// operations by a member over subsets of the candidate days, the member retains <b>at most one</b>
/// stored <see cref="AvailabilityResponse"/>, and that response is <b>equal to the most recent
/// submission</b>: a submit upserts (replacing any prior response), a clear removes the stored
/// response entirely (reverting to none), and a submission marking an <b>empty</b> subset stores a
/// response that is distinct from having none (<see cref="Match.GetAvailabilityResponse"/> returns a
/// non-null empty-subset response rather than <see langword="null"/>).
/// </para>
/// <para>
/// The property drives a random sequence of operations for one member against a model that tracks
/// the expected stored subset (or its absence), asserting the invariants after every operation. A
/// second, untouched member is seeded up front so the "at most one per member" and isolation aspects
/// are exercised too. The property runs at least 100 iterations.
/// </para>
/// </summary>
[Trait("Feature", "match-lifecycle")]
public class MatchAvailabilityResponsePropertyTests
{
    private static readonly DateTimeOffset ClockNow = new(2025, 1, 1, 0, 0, 0, TimeSpan.Zero);

    // Feature: match-lifecycle, Property 4: Availability responses are single-valued and honour empty vs cleared
    // Validates: Requirements 4.1, 4.2, 4.3, 4.7
    [Property(MaxTest = 100)]
    [Trait("Property", "4")]
    public Property ResponsesAreSingleValuedAndHonourEmptyVersusCleared() =>
        Prop.ForAll(Arb.From(ScenarioGen()), scenario =>
        {
            var match = CreateGatheringMatch(scenario.CandidateDays);
            var memberId = Guid.NewGuid();

            // A second member is seeded with a fixed response and never touched, so the per-member
            // "single-valued" invariant and isolation across members are both exercised.
            var otherId = Guid.NewGuid();
            var otherMarked = scenario.CandidateDays.Take(1).ToArray();
            match.SubmitAvailability(otherId, otherMarked, ClockNow.AddMinutes(1));

            // The model: null means "no stored response"; a value means "stored response marking exactly this set".
            HashSet<CandidateDay>? expected = null;

            foreach (var op in scenario.Operations)
            {
                if (op.IsClear)
                {
                    var clear = match.ClearAvailability(memberId);
                    if (!clear.IsSuccess)
                    {
                        return false.ToProperty();
                    }

                    expected = null;
                }
                else
                {
                    var submit = match.SubmitAvailability(memberId, op.MarkedDays!, op.SubmittedAt);
                    if (!submit.IsSuccess)
                    {
                        return false.ToProperty();
                    }

                    expected = op.MarkedDays!.Select(d => new CandidateDay(d)).ToHashSet();
                }

                if (!InvariantsHold(match, memberId, expected))
                {
                    return false.ToProperty();
                }
            }

            // The untouched member keeps exactly its one response throughout.
            var otherStored = match.GetAvailabilityResponse(otherId);
            var otherIntact = otherStored is not null
                && match.AvailabilityResponses.Count(r => r.SquadMembershipId == otherId) == 1
                && SetOf(otherStored.MarkedDays).SetEquals(otherMarked.Select(d => new CandidateDay(d)));

            return otherIntact.ToProperty();
        });

    /// <summary>
    /// Asserts, for <paramref name="memberId"/>, the Property 4 invariants against the current model
    /// <paramref name="expected"/> (null = no stored response; a set = the marked subset the member's
    /// single stored response must equal).
    /// </summary>
    private static bool InvariantsHold(Match match, Guid memberId, HashSet<CandidateDay>? expected)
    {
        // Single-valued: never more than one stored response for the member.
        var storedCount = match.AvailabilityResponses.Count(r => r.SquadMembershipId == memberId);
        if (storedCount > 1)
        {
            return false;
        }

        var stored = match.GetAvailabilityResponse(memberId);

        if (expected is null)
        {
            // A clear (or no submission yet) leaves the member with no stored response at all.
            return stored is null && storedCount == 0;
        }

        // A submission — including an empty-subset one — stores exactly one response distinct from
        // having none, whose marked days equal the most recent submission.
        return stored is not null
            && storedCount == 1
            && SetOf(stored.MarkedDays).SetEquals(expected);
    }

    private static HashSet<CandidateDay> SetOf(IEnumerable<CandidateDay> days) => days.ToHashSet();

    /// <summary>Builds a valid draft (which starts in <see cref="MatchState.GatheringAvailability"/>) over the given days.</summary>
    private static Match CreateGatheringMatch(DateTimeOffset[] candidateDays)
    {
        var result = Match.CreateDraft(Guid.Empty, Guid.NewGuid(), "Community Astro Pitch", candidateDays, ClockNow);
        return result.Value ?? throw new InvalidOperationException("Draft creation failed unexpectedly.");
    }

    // ---- Generators -----------------------------------------------------------------------------

    /// <summary>A single member operation: either a clear, or a submit marking a (possibly empty) subset of candidate days.</summary>
    private sealed record Operation(bool IsClear, DateTimeOffset[]? MarkedDays, DateTimeOffset SubmittedAt);

    /// <summary>A generated scenario: the match's candidate days and a sequence of operations for one member.</summary>
    private sealed record Scenario(DateTimeOffset[] CandidateDays, Operation[] Operations);

    /// <summary>Generates a match's candidate days plus a sequence of submit/clear operations over subsets of them.</summary>
    private static Gen<Scenario> ScenarioGen() =>
        from dayCount in Gen.Choose(Match.CandidateDayMinCount, 8)
        from gaps in Gen.ArrayOf(Gen.Choose(1, 500), dayCount)
        let days = StrictlyIncreasingFuture(gaps)
        from ops in Gen.ArrayOf(OperationGen(days))
        select new Scenario(days, ops);

    /// <summary>Generates a single operation: a clear (weight 1) or a submit over a random subset (weight 3).</summary>
    private static Gen<Operation> OperationGen(DateTimeOffset[] days) =>
        Gen.Frequency(
            (1, ClearGen()),
            (3, SubmitGen(days)));

    /// <summary>Generates a clear operation.</summary>
    private static Gen<Operation> ClearGen() =>
        from minute in Gen.Choose(0, 100_000)
        select new Operation(IsClear: true, MarkedDays: null, SubmittedAt: ClockNow.AddMinutes(minute));

    /// <summary>Generates a submit operation marking a random (possibly empty, possibly full) subset of <paramref name="days"/>.</summary>
    private static Gen<Operation> SubmitGen(DateTimeOffset[] days) =>
        from flags in Gen.ArrayOf(Gen.Elements(true, false), days.Length)
        from minute in Gen.Choose(0, 100_000)
        let subset = days.Where((_, i) => flags[i]).ToArray()
        select new Operation(IsClear: false, MarkedDays: subset, SubmittedAt: ClockNow.AddMinutes(minute));

    /// <summary>Builds strictly-increasing, distinct future days from positive gaps relative to <see cref="ClockNow"/>.</summary>
    private static DateTimeOffset[] StrictlyIncreasingFuture(int[] gaps)
    {
        var days = new DateTimeOffset[gaps.Length];
        long acc = 0;
        for (var i = 0; i < gaps.Length; i++)
        {
            acc += gaps[i]; // gaps >= 1, so acc is strictly increasing and positive
            days[i] = ClockNow.AddMinutes(acc);
        }

        return days;
    }
}
