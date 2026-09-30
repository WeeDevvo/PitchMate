using FsCheck;
using PitchMate.Domain.Matches;

namespace PitchMate.Infrastructure.Tests.Stats;

/// <summary>
/// FsCheck <see cref="Gen{T}"/> factory producing the <see cref="StatsDatasetSpec"/> shape the
/// membership-standing scope property (api-response-contracts Property 20, task 6.2) needs: exactly
/// <b>two</b> squads, each carrying a mix of completed and non-completed matches over a shared
/// membership pool.
/// <para>
/// The generator is deliberately structured so the property can never pass on degenerate data. Every
/// generated squad is guaranteed to contain, whatever FsCheck rolls:
/// </para>
/// <list type="bullet">
///   <item>
///   <description>
///   <b>two completed matches whose rosters nest.</b> Both draw from the pool with the <em>same</em>
///   shuffle seed, and the seeder's shuffle is deterministic in (pool size, seed), so the smaller
///   match's roster is a strict prefix — and therefore a strict subset — of the larger one's. That
///   fixes three distinct expected counts into every squad: the members of the smaller roster appear
///   <b>twice</b> (so a count that does not accumulate fails), the members of the larger roster only
///   appear <b>once</b> (so a count that reports "any appearance" as the match total fails), and the
///   <c>PoolSize - largeTotal ≥ 2</c> members outside both appear <b>zero</b> times.
///   </description>
///   </item>
///   <item>
///   <description>
///   <b>at least one non-completed match that still has a locked kickoff lineup</b>
///   (<see cref="MatchState.TeamsRolled"/> or <see cref="MatchState.InProgress"/>), drawn from the
///   same pool with its own seed — so some membership sits in a roster that must not be counted, and
///   the completed-only restriction is load-bearing rather than incidental.
///   </description>
///   </item>
///   <item>
///   <description>
///   <b>no further completed matches.</b> The zero to two extra matches are drawn from the
///   non-completed states only, so the "members outside every completed roster" guarantee above
///   survives them while they add teamless states and further uncounted lineups.
///   </description>
///   </item>
/// </list>
/// <para>
/// The first squad's memberships carry a rating about 70% of the time; the second squad's carry
/// <b>none</b>. Combined with the guaranteed zero-appearance members, that fixes at least one
/// membership per generated case whose standing is "nothing to report" — the case the interface
/// defines as an absent dictionary entry — so the assertion over absent entries is never vacuous.
/// </para>
/// </summary>
public static class StandingScopeDatasetGenerators
{
    /// <summary>The membership pool size of every generated squad; larger than any single roster.</summary>
    public const int PoolSize = 16;

    /// <summary>The smaller completed match's team sizes; its roster nests inside the larger one's.</summary>
    private static readonly int[] SmallCompletedTeamSizes = [5, 5];

    /// <summary>The non-completed states the extra matches are drawn from — never <c>Completed</c>.</summary>
    private static readonly MatchState[] NonCompletedStates =
    [
        MatchState.TeamsRolled,
        MatchState.InProgress,
        MatchState.Confirmed,
        MatchState.GatheringAvailability,
        MatchState.Cancelled
    ];

    /// <summary>The non-completed states that still carry a locked kickoff lineup.</summary>
    private static readonly MatchState[] RosterBearingNonCompletedStates =
    [
        MatchState.TeamsRolled,
        MatchState.InProgress
    ];

    /// <summary>
    /// A two-squad dataset: the first squad's memberships mostly carry ratings, the second squad's
    /// carry none, so both the "standing to report" and the "nothing to report" cases occur in every
    /// generated case.
    /// </summary>
    public static Gen<StatsDatasetSpec> Dataset() =>
        from first in Squad(ratingChancePercent: 70)
        from second in Squad(ratingChancePercent: 0)
        select new StatsDatasetSpec([first, second]);

    /// <summary>
    /// One squad: a pool of <see cref="PoolSize"/> memberships, two nesting completed matches, one
    /// roster-bearing non-completed match, and zero to two further non-completed matches.
    /// </summary>
    /// <param name="ratingChancePercent">The percentage of the pool that carries a current rating.</param>
    private static Gen<StatsDatasetSpec.SquadSpec> Squad(int ratingChancePercent) =>
        from liveTracking in Chance(50)
        from members in ListOfLength(PoolSize, Membership(ratingChancePercent))
        // One seed shared by both completed matches, so the smaller roster nests inside the larger.
        from sharedSeed in Gen.Choose(0, 1_000_000)
        // Strictly larger than the smaller total (10) and strictly smaller than the pool (16), so
        // members with counts of two, one, and zero all exist.
        from largeTotal in Gen.Choose(12, 14)
        from smallCompleted in CompletedMatch(SmallCompletedTeamSizes, sharedSeed)
        from largeCompleted in CompletedMatch(SplitInTwo(largeTotal), sharedSeed)
        from rosterBearing in NonCompletedMatch(Gen.Elements(RosterBearingNonCompletedStates))
        from extraCount in Gen.Choose(0, 2)
        from extras in ListOfLength(extraCount, NonCompletedMatch(Gen.Elements(NonCompletedStates)))
        select new StatsDatasetSpec.SquadSpec(
            liveTracking,
            members,
            Concat(smallCompleted, largeCompleted, rosterBearing, extras));

    /// <summary>One membership: guest/registered, possibly inactive and/or anonymised, rating or none.</summary>
    /// <param name="ratingChancePercent">The chance the membership carries a current rating.</param>
    private static Gen<StatsDatasetSpec.MembershipSpec> Membership(int ratingChancePercent) =>
        from isGuest in Chance(30)
        from inactive in Chance(20)
        from anonymise in Chance(15)
        from hasRating in Chance(ratingChancePercent)
        from rating in Rating()
        select new StatsDatasetSpec.MembershipSpec(isGuest, inactive, anonymise, hasRating ? rating : null);

    /// <summary>A current rating with finite μ in [15, 35] and σ in [0.5, 9.0].</summary>
    private static Gen<StatsDatasetSpec.RatingSpec> Rating() =>
        from muMilli in Gen.Choose(15_000, 35_000)
        from sigmaMilli in Gen.Choose(500, 9_000)
        select new StatsDatasetSpec.RatingSpec(muMilli / 1000.0, sigmaMilli / 1000.0);

    /// <summary>A completed match with the given team sizes, drawn from the pool with the given seed.</summary>
    private static Gen<StatsDatasetSpec.MatchSpec> CompletedMatch(IReadOnlyList<int> teamSizes, int shuffleSeed) =>
        from scores in ListOfLength(teamSizes.Count, Gen.Choose(0, 10))
        from bibIndex in Gen.Choose(0, teamSizes.Count - 1)
        from completedOffset in Gen.Choose(0, 8)
        select new StatsDatasetSpec.MatchSpec(
            MatchState.Completed,
            // Basic keeps the match independent of the squad's live-tracking flag; fidelity is
            // irrelevant to an appearance count, which is derived from the kickoff lineup.
            ResultFidelity.Basic,
            teamSizes,
            shuffleSeed,
            scores,
            bibIndex,
            completedOffset);

    /// <summary>A non-completed match in one of the supplied states, with its own roster draw.</summary>
    private static Gen<StatsDatasetSpec.MatchSpec> NonCompletedMatch(Gen<MatchState> states) =>
        from state in states
        // Two teams of 5..8 never exceed the pool of 16, so every draw is seedable.
        from firstSize in Gen.Choose(5, 8)
        from secondSize in Gen.Choose(5, 8)
        from shuffleSeed in Gen.Choose(0, 1_000_000)
        from scores in ListOfLength(2, Gen.Choose(0, 10))
        from bibIndex in Gen.Choose(0, 1)
        from completedOffset in Gen.Choose(0, 8)
        select new StatsDatasetSpec.MatchSpec(
            state,
            ResultFidelity.Basic,
            [firstSize, secondSize],
            shuffleSeed,
            scores,
            bibIndex,
            completedOffset);

    /// <summary>Splits a roster total into two teams whose sizes stay within the domain's 5..8 range.</summary>
    private static IReadOnlyList<int> SplitInTwo(int total) => [total / 2, total - (total / 2)];

    /// <summary>A boolean that is <see langword="true"/> roughly <paramref name="percent"/>% of the time.</summary>
    private static Gen<bool> Chance(int percent) =>
        from roll in Gen.Choose(0, 99)
        select roll < percent;

    /// <summary>A list of exactly <paramref name="length"/> items drawn from <paramref name="element"/>.</summary>
    private static Gen<IReadOnlyList<T>> ListOfLength<T>(int length, Gen<T> element)
    {
        if (length <= 0)
        {
            return Gen.Constant((IReadOnlyList<T>)new List<T>());
        }

        return from head in element
               from tail in ListOfLength(length - 1, element)
               select Prepend(head, tail);
    }

    private static IReadOnlyList<T> Prepend<T>(T head, IReadOnlyList<T> tail)
    {
        var result = new List<T>(tail.Count + 1) { head };
        result.AddRange(tail);
        return result;
    }

    private static IReadOnlyList<StatsDatasetSpec.MatchSpec> Concat(
        StatsDatasetSpec.MatchSpec first,
        StatsDatasetSpec.MatchSpec second,
        StatsDatasetSpec.MatchSpec third,
        IReadOnlyList<StatsDatasetSpec.MatchSpec> rest)
    {
        var matches = new List<StatsDatasetSpec.MatchSpec>(rest.Count + 3) { first, second, third };
        matches.AddRange(rest);
        return matches;
    }
}
