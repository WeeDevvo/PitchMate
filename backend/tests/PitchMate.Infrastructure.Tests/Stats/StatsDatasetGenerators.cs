using FsCheck;
using PitchMate.Domain.Matches;

namespace PitchMate.Infrastructure.Tests.Stats;

/// <summary>
/// FsCheck <see cref="Gen{T}"/> factories that produce <see cref="StatsDatasetSpec"/> values for the
/// model-based stats property tests (tasks 6.2–6.11). The generated datasets deliberately exercise the
/// edge cases the properties depend on inside the generator rather than as separate tests:
/// <list type="bullet">
///   <item>one to three squads, so squad isolation can be checked;</item>
///   <item>matches spanning <em>every</em> <see cref="MatchState"/> (weighted toward
///   <see cref="MatchState.Completed"/>), so completed-only derivation is exercised — including
///   non-completed matches that <em>do</em> have kickoff lineups (<see cref="MatchState.TeamsRolled"/>,
///   <see cref="MatchState.InProgress"/>) and so must be excluded;</item>
///   <item>two- and three-team, evenly- and unevenly-sized lineups (each team 5..8) with a single bib
///   team, drawn from a shared pool so teammates and opponents recur across matches;</item>
///   <item>basic and (only when the squad tracks live) rich results, and completion instants that
///   sometimes coincide so the match-identity tie-break is hit;</item>
///   <item>guest memberships, memberships that become inactive or anonymised, and memberships with a
///   rating or none — covering the profile/leaderboard eligibility and historical-stability cases.</item>
/// </list>
/// </summary>
public static class StatsDatasetGenerators
{
    // Weighted so completed matches dominate but every other state still appears regularly.
    private static readonly MatchState[] StateChoices =
    [
        MatchState.Completed,
        MatchState.Completed,
        MatchState.Completed,
        MatchState.Completed,
        MatchState.TeamsRolled,
        MatchState.InProgress,
        MatchState.Confirmed,
        MatchState.GatheringAvailability,
        MatchState.Cancelled
    ];

    /// <summary>A complete dataset of one to three squads.</summary>
    public static Gen<StatsDatasetSpec> Dataset() =>
        from squadCount in Gen.Choose(1, 3)
        from squads in ListOfLength(squadCount, Squad())
        select new StatsDatasetSpec(squads);

    /// <summary>One squad: a live-tracking flag, a membership pool of 15..20, and 1..6 matches.</summary>
    public static Gen<StatsDatasetSpec.SquadSpec> Squad() =>
        from liveTracking in Chance(50)
        from poolSize in Gen.Choose(15, 20)
        from members in ListOfLength(poolSize, Membership())
        from matchCount in Gen.Choose(1, 6)
        from matches in ListOfLength(matchCount, Match(poolSize, liveTracking))
        select new StatsDatasetSpec.SquadSpec(liveTracking, members, matches);

    /// <summary>One membership: guest/registered, possibly inactive and/or anonymised, with a rating or none.</summary>
    public static Gen<StatsDatasetSpec.MembershipSpec> Membership() =>
        from isGuest in Chance(30)
        from inactive in Chance(20)
        from anonymise in Chance(15)
        from hasRating in Chance(75)
        from rating in Rating()
        select new StatsDatasetSpec.MembershipSpec(isGuest, inactive, anonymise, hasRating ? rating : null);

    /// <summary>A current rating with finite μ in [15, 35] and σ in [0.5, 9.0], straddling the provisional threshold.</summary>
    private static Gen<StatsDatasetSpec.RatingSpec> Rating() =>
        from muMilli in Gen.Choose(15_000, 35_000)
        from sigmaMilli in Gen.Choose(500, 9_000)
        select new StatsDatasetSpec.RatingSpec(muMilli / 1000.0, sigmaMilli / 1000.0);

    /// <summary>One match sized to the pool: a state, team sizes (each 5..8), a bib team, scores, and timing.</summary>
    private static Gen<StatsDatasetSpec.MatchSpec> Match(int poolSize, bool liveTracking) =>
        from state in Gen.Elements(StateChoices)
        from teamCount in Gen.Elements(2, 2, 3)
        from sizes in ListOfLength(teamCount, Gen.Choose(5, Math.Min(8, poolSize / teamCount)))
        from shuffleSeed in Gen.Choose(0, 1_000_000)
        from scores in ListOfLength(teamCount, Gen.Choose(0, 10))
        from bibIndex in Gen.Choose(0, teamCount - 1)
        from fidelity in liveTracking
            ? Gen.Elements(ResultFidelity.Basic, ResultFidelity.Rich)
            : Gen.Constant(ResultFidelity.Basic)
        from completedOffset in Gen.Choose(0, 8)
        select new StatsDatasetSpec.MatchSpec(state, fidelity, sizes, shuffleSeed, scores, bibIndex, completedOffset);

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
}
