using PitchMate.Domain.Common;
using PitchMate.Domain.Matches;

namespace PitchMate.Domain.Tests.Matches;

/// <summary>
/// Unit tests for <see cref="MatchSchedulingOrder"/>, the match-list ordering key stated once as a
/// pure Domain rule (Requirement 1.9): scheduling instant descending, tie-broken by identity
/// descending, where a match's scheduling instant is its confirmed day when it has one and otherwise
/// the earliest of its candidate days.
/// <para>
/// This comparer is the oracle the match-list query's in-database <c>ORDER BY</c> is validated
/// against, so the rule is exercised directly here: the confirmed-day key, the earliest-candidate-day
/// key for days supplied out of chronological order, the identity tie-break on equal instants, and
/// the strictness and totality of the resulting order over a mixed set.
/// </para>
/// </summary>
[Trait("Feature", "match-read-models")]
public class MatchSchedulingOrderTests
{
    /// <summary>A fixed UTC instant every candidate day hangs off, keeping the scenarios deterministic.</summary>
    private static readonly DateTimeOffset Anchor = new(2025, 1, 1, 12, 0, 0, TimeSpan.Zero);

    /// <summary>A confirmed match's scheduling instant is its confirmed day.</summary>
    [Fact]
    public void ConfirmedMatchIsScheduledAtItsConfirmedDay()
    {
        DateTimeOffset confirmedDay = Anchor.AddDays(9);
        Match match = Confirmed(confirmedDay, Anchor.AddDays(3), confirmedDay, Anchor.AddDays(20));

        Assert.Equal(confirmedDay, MatchSchedulingOrder.SchedulingInstantOf(match));
    }

    /// <summary>
    /// An unconfirmed match's scheduling instant is the earliest of its candidate days, found by
    /// scanning rather than by taking the first, because a draft may supply its days in any order.
    /// </summary>
    [Fact]
    public void UnconfirmedMatchIsScheduledAtItsEarliestCandidateDayEvenWhenSuppliedOutOfOrder()
    {
        Match match = Draft(Anchor.AddDays(20), Anchor.AddDays(4), Anchor.AddDays(11));

        Assert.Equal(Anchor.AddDays(4), MatchSchedulingOrder.SchedulingInstantOf(match));
    }

    /// <summary>
    /// Confirming overrides the candidate days as the key: a match confirmed on an early day sorts
    /// after an unconfirmed draft whose earliest candidate day is later, even though that same
    /// confirmed match carries a much later candidate day.
    /// </summary>
    [Fact]
    public void ConfirmedDayRatherThanCandidateDaysDecidesTheOrder()
    {
        DateTimeOffset earlyConfirmedDay = Anchor.AddDays(5);
        Match confirmedEarly = Confirmed(earlyConfirmedDay, earlyConfirmedDay, Anchor.AddDays(30));
        Match draftedLater = Draft(Anchor.AddDays(10), Anchor.AddDays(40));

        IReadOnlyList<Match> ordered = MatchSchedulingOrder.ForMatchList([confirmedEarly, draftedLater]);

        Assert.Equal(new[] { draftedLater.Id, confirmedEarly.Id }, ordered.Select(match => match.Id));
    }

    /// <summary>The later scheduling instant sorts first: the order is descending.</summary>
    [Fact]
    public void LaterSchedulingInstantSortsFirst()
    {
        Match soon = Draft(Anchor.AddDays(2));
        Match later = Draft(Anchor.AddDays(8));

        IReadOnlyList<Match> ordered = MatchSchedulingOrder.ForMatchList([soon, later]);

        Assert.Equal(new[] { later.Id, soon.Id }, ordered.Select(match => match.Id));
        Assert.True(MatchSchedulingOrder.Instance.Compare(later, soon) < 0);
        Assert.True(MatchSchedulingOrder.Instance.Compare(soon, later) > 0);
    }

    /// <summary>
    /// A pair whose scheduling instants are equal is separated by the identity tie-break — the greater
    /// identity, by the canonical big-endian byte order PostgreSQL sorts <c>uuid</c> in, sorts first —
    /// and the two never compare equal.
    /// </summary>
    [Fact]
    public void EqualSchedulingInstantsAreSeparatedByTheIdentityTieBreak()
    {
        DateTimeOffset sameDay = Anchor.AddDays(6);
        Match first = Draft(sameDay);
        Match second = Draft(sameDay);

        Assert.Equal(
            MatchSchedulingOrder.SchedulingInstantOf(first),
            MatchSchedulingOrder.SchedulingInstantOf(second));

        (Match greater, Match lesser) = UuidV7Comparer.Compare(first.Id, second.Id) > 0
            ? (first, second)
            : (second, first);

        Assert.True(MatchSchedulingOrder.Instance.Compare(greater, lesser) < 0);
        Assert.True(MatchSchedulingOrder.Instance.Compare(lesser, greater) > 0);
        Assert.NotEqual(0, MatchSchedulingOrder.Instance.Compare(first, second));

        IReadOnlyList<Match> ordered = MatchSchedulingOrder.ForMatchList([lesser, greater]);
        Assert.Equal(new[] { greater.Id, lesser.Id }, ordered.Select(match => match.Id));
    }

    /// <summary>
    /// Over a mixed set — confirmed and unconfirmed matches, candidate days supplied out of
    /// chronological order, and several pairs sharing a scheduling instant — the order is strict (no
    /// adjacent pair compares equal or out of order) and total (any input permutation yields the
    /// identical sequence).
    /// </summary>
    [Fact]
    public void OrderIsStrictAndTotalOverAMixedSet()
    {
        DateTimeOffset tiedDay = Anchor.AddDays(7);

        List<Match> matches =
        [
            Draft(Anchor.AddDays(30), Anchor.AddDays(3)),      // earliest candidate day: +3
            Draft(tiedDay),                                     // tied at +7
            Draft(Anchor.AddDays(12), tiedDay),                 // tied at +7, days out of order
            Confirmed(tiedDay, Anchor.AddDays(2), tiedDay),     // tied at +7, by confirmation
            Confirmed(Anchor.AddDays(21), Anchor.AddDays(21)),  // +21
            Draft(Anchor.AddDays(1)),                           // +1
            Draft(Anchor.AddDays(40), Anchor.AddDays(25))       // earliest candidate day: +25
        ];

        IReadOnlyList<Match> ordered = MatchSchedulingOrder.ForMatchList(matches);

        Assert.Equal(matches.Count, ordered.Count);
        Assert.Equal(
            matches.Select(match => match.Id).ToHashSet(),
            ordered.Select(match => match.Id).ToHashSet());

        // Strict: every adjacent pair is strictly increasing under the comparer, and the key itself is
        // non-increasing, so no two returned entries compare equal.
        for (var i = 0; i < ordered.Count - 1; i++)
        {
            Match a = ordered[i];
            Match b = ordered[i + 1];

            Assert.True(
                MatchSchedulingOrder.Instance.Compare(a, b) < 0,
                $"entry {i} did not strictly precede entry {i + 1}");
            Assert.True(
                MatchSchedulingOrder.SchedulingInstantOf(a) >= MatchSchedulingOrder.SchedulingInstantOf(b),
                $"entry {i} carried an earlier scheduling instant than entry {i + 1}");
        }

        // Total: the same set in any permutation yields the identical sequence.
        List<Guid> expected = [.. ordered.Select(match => match.Id)];
        foreach (IReadOnlyList<Match> permutation in Rotations(matches))
        {
            Assert.Equal(expected, MatchSchedulingOrder.ForMatchList(permutation).Select(match => match.Id));
        }

        Assert.Equal(expected, MatchSchedulingOrder.ForMatchList(Enumerable.Reverse(matches)).Select(match => match.Id));
    }

    /// <summary>Every rotation of <paramref name="matches"/>, used as a deterministic permutation set.</summary>
    private static IEnumerable<IReadOnlyList<Match>> Rotations(IReadOnlyList<Match> matches)
    {
        for (var offset = 1; offset < matches.Count; offset++)
        {
            yield return [.. matches.Skip(offset), .. matches.Take(offset)];
        }
    }

    /// <summary>Creates an unconfirmed draft carrying exactly <paramref name="candidateDays"/>.</summary>
    private static Match Draft(params DateTimeOffset[] candidateDays) =>
        Match.CreateDraft(Guid.CreateVersion7(), Guid.CreateVersion7(), "Central Pitch", candidateDays, Anchor).Value!;

    /// <summary>
    /// Creates a draft carrying <paramref name="candidateDays"/> and confirms it on
    /// <paramref name="confirmDay"/>, which must be one of them.
    /// </summary>
    private static Match Confirmed(DateTimeOffset confirmDay, params DateTimeOffset[] candidateDays)
    {
        Match match = Draft(candidateDays);
        Assert.True(match
            .Confirm(confirmDay, availableCount: 0, minimumThreshold: 0, activeRegisteredMembers: [])
            .IsSuccess);
        return match;
    }
}
