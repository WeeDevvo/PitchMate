using FsCheck;
using PitchMate.Domain.Rating;

namespace PitchMate.Infrastructure.Tests.Generators;

/// <summary>
/// FsCheck (C#) <see cref="Gen{T}"/> factories that produce values for the rating-engine
/// property tests. Generators are grouped into "valid" producers (inputs the engine must
/// accept) and "malformed" producers (inputs the engine must reject, consumed by the
/// rejection properties — see design Properties 22 and 23).
/// </summary>
/// <remarks>
/// Doubles are produced from bounded integer ranges so they are always finite (no NaN /
/// ±Infinity) unless a generator is explicitly designed to inject a non-finite value.
/// </remarks>
public static class RatingGenerators
{
    // --- Primitive double generators (all finite by construction) ---

    /// <summary>Finite μ in the closed range [-50, 50].</summary>
    private static Gen<double> FiniteMu =>
        from milli in Gen.Choose(-50_000, 50_000)
        select milli / 1000.0;

    /// <summary>Strictly positive, finite σ in the half-open range (0, 50].</summary>
    private static Gen<double> PositiveSigma =>
        from milli in Gen.Choose(1, 50_000)
        select milli / 1000.0;

    /// <summary>Strictly positive, finite value in the half-open range (0, 10].</summary>
    private static Gen<double> PositiveSmall =>
        from milli in Gen.Choose(1, 10_000)
        select milli / 1000.0;

    /// <summary>Non-negative, finite value in the closed range [0, 10].</summary>
    private static Gen<double> NonNegativeSmall =>
        from milli in Gen.Choose(0, 10_000)
        select milli / 1000.0;

    /// <summary>A non-finite double: NaN, +Infinity, or -Infinity.</summary>
    private static Gen<double> NonFiniteDouble =>
        Gen.Elements(double.NaN, double.PositiveInfinity, double.NegativeInfinity);

    // --- Valid generators ---

    /// <summary>A valid <see cref="Rating"/>: finite μ and strictly positive, finite σ.</summary>
    public static Gen<Rating> ValidRating() =>
        from mu in FiniteMu
        from sigma in PositiveSigma
        select new Rating(mu, sigma);

    /// <summary>
    /// A <see cref="Rating"/> whose σ may be exactly zero (σ in [0, 50]); μ is finite.
    /// Useful for the GetState σ = 0 boundary (design Property 2 / Requirement 1.5).
    /// </summary>
    public static Gen<Rating> RatingAllowingZeroSigma() =>
        from mu in FiniteMu
        from milli in Gen.Choose(0, 50_000)
        select new Rating(mu, milli / 1000.0);

    /// <summary>
    /// A valid <see cref="RatingEngineConfig"/> satisfying every validation rule: all values
    /// finite, positive initial uncertainty and provisional threshold, non-negative decay
    /// parameters, MarginMultiplierMax ≥ 1.0, and tier means strictly ordered
    /// Strong &gt; Average &gt; Beginner.
    /// </summary>
    public static Gen<RatingEngineConfig> ValidConfig() =>
        from defaultMean in FiniteMu
        from initialUncertainty in PositiveSigma
        from beta in PositiveSigma
        from tau in NonNegativeSmall
        from provisionalThreshold in PositiveSigma
        from decayFreeDays in Gen.Choose(0, 365)
        from decayRate in NonNegativeSmall
        from movEnabled in Gen.Elements(true, false)
        from participationEnabled in Gen.Elements(true, false)
        from beginnerMean in FiniteMu
        from averageGap in PositiveSmall
        from strongGap in PositiveSmall
        from marginExtra in NonNegativeSmall
        select new RatingEngineConfig
        {
            DefaultMean = defaultMean,
            InitialUncertainty = initialUncertainty,
            Beta = beta,
            Tau = tau,
            ProvisionalThreshold = provisionalThreshold,
            DecayFreePeriodDays = decayFreeDays,
            DecayRate = decayRate,
            MarginOfVictoryWeightingEnabled = movEnabled,
            ParticipationWeightingEnabled = participationEnabled,
            BeginnerMean = beginnerMean,
            AverageMean = beginnerMean + averageGap,
            StrongMean = beginnerMean + averageGap + strongGap,
            MarginMultiplierMax = 1.0 + marginExtra,
            NumericTolerance = 1e-9
        };

    /// <summary>A valid player input wrapping a valid rating (no participation value).</summary>
    public static Gen<PlayerInput> ValidPlayerInput() =>
        from rating in ValidRating()
        select new PlayerInput(rating);

    /// <summary>
    /// A valid <see cref="TeamResult"/>: 1–4 players (so outcomes can be uneven) and a
    /// non-negative rank in [0, 3] (so ties across teams arise naturally).
    /// </summary>
    public static Gen<TeamResult> ValidTeamResult() =>
        from playerCount in Gen.Choose(1, 4)
        from players in ListOfLength(playerCount, ValidPlayerInput())
        from rank in Gen.Choose(0, 3)
        select new TeamResult(players, rank);

    /// <summary>
    /// A valid <see cref="MatchOutcome"/>: 2–5 teams, each with at least one player, allowing
    /// uneven team sizes and tied ranks. No goal margin is supplied.
    /// </summary>
    public static Gen<MatchOutcome> ValidMatchOutcome() =>
        from teamCount in Gen.Choose(2, 5)
        from teams in ListOfLength(teamCount, ValidTeamResult())
        select new MatchOutcome(teams);

    /// <summary>A valid <see cref="TeamRoster"/> of 1–5 players with valid ratings.</summary>
    public static Gen<TeamRoster> ValidTeamRoster() =>
        from playerCount in Gen.Choose(1, 5)
        from players in ListOfLength(playerCount, ValidRating())
        select new TeamRoster(players);

    /// <summary>Two or more valid rosters, suitable input for <c>Predict</c>.</summary>
    public static Gen<IReadOnlyList<TeamRoster>> ValidRosters() =>
        from rosterCount in Gen.Choose(2, 4)
        from rosters in ListOfLength(rosterCount, ValidTeamRoster())
        select (IReadOnlyList<TeamRoster>)rosters;

    // --- Malformed generators (consumed by the rejection properties, design Property 22/23) ---

    /// <summary>An outcome with fewer than two teams (0 or 1) — expects <c>TooFewTeams</c>.</summary>
    public static Gen<MatchOutcome> TooFewTeamsOutcome() =>
        from teamCount in Gen.Choose(0, 1)
        from teams in ListOfLength(teamCount, ValidTeamResult())
        select new MatchOutcome(teams);

    /// <summary>An otherwise-valid outcome with one empty team — expects <c>EmptyTeam</c>.</summary>
    public static Gen<MatchOutcome> EmptyTeamOutcome() =>
        from teamCount in Gen.Choose(2, 4)
        from teams in ListOfLength(teamCount, ValidTeamResult())
        from emptyIndex in Gen.Choose(0, teamCount - 1)
        from rank in Gen.Choose(0, 3)
        select ReplaceTeam(teams, emptyIndex, new TeamResult(new List<PlayerInput>(), rank));

    /// <summary>A rating with σ ≤ 0 (σ in [-50, 0]) — expects <c>NonPositiveSigma</c>.</summary>
    public static Gen<Rating> NonPositiveSigmaRating() =>
        from mu in FiniteMu
        from milli in Gen.Choose(-50_000, 0)
        select new Rating(mu, milli / 1000.0);

    /// <summary>A rating with a non-finite μ or σ — expects <c>NonFiniteValue</c>.</summary>
    public static Gen<Rating> NonFiniteRating() =>
        Gen.OneOf(
            from sigma in PositiveSigma
            from mu in NonFiniteDouble
            select new Rating(mu, sigma),
            from mu in FiniteMu
            from sigma in NonFiniteDouble
            select new Rating(mu, sigma));

    /// <summary>An otherwise-valid outcome with one negative-rank team — expects <c>NegativeRank</c>.</summary>
    public static Gen<MatchOutcome> NegativeRankOutcome() =>
        from teamCount in Gen.Choose(2, 4)
        from teams in ListOfLength(teamCount, ValidTeamResult())
        from badIndex in Gen.Choose(0, teamCount - 1)
        from negativeRank in Gen.Choose(-100, -1)
        from players in ListOfLength(1, ValidPlayerInput())
        select ReplaceTeam(teams, badIndex, new TeamResult(players, negativeRank));

    /// <summary>An otherwise-valid outcome containing one rating with σ ≤ 0.</summary>
    public static Gen<MatchOutcome> OutcomeWithNonPositiveSigma() =>
        OutcomeWithInjectedRating(NonPositiveSigmaRating());

    /// <summary>An otherwise-valid outcome containing one non-finite rating.</summary>
    public static Gen<MatchOutcome> OutcomeWithNonFiniteRating() =>
        OutcomeWithInjectedRating(NonFiniteRating());

    /// <summary>
    /// A <see cref="RatingEngineConfig"/> violating exactly one validation rule — expects
    /// <c>InvalidConfiguration</c> from every operation (design Property 23 / Requirement 11.5).
    /// </summary>
    public static Gen<RatingEngineConfig> InvalidConfig() =>
        from baseConfig in ValidConfig()
        from mutation in Gen.Choose(0, 5)
        select mutation switch
        {
            0 => baseConfig with { InitialUncertainty = 0.0 },
            1 => baseConfig with { ProvisionalThreshold = -1.0 },
            2 => baseConfig with { DecayRate = -0.5 },
            3 => baseConfig with { MarginMultiplierMax = 0.5 },
            4 => baseConfig with { DefaultMean = double.NaN },
            // Tier means not strictly ordered (Strong not greater than Average).
            _ => baseConfig with { StrongMean = baseConfig.AverageMean }
        };

    /// <summary>Fewer than two rosters (0 or 1) — expects <c>InvalidRosterInput</c>.</summary>
    public static Gen<IReadOnlyList<TeamRoster>> TooFewRosters() =>
        from rosterCount in Gen.Choose(0, 1)
        from rosters in ListOfLength(rosterCount, ValidTeamRoster())
        select (IReadOnlyList<TeamRoster>)rosters;

    /// <summary>Two or more rosters where one is empty — expects <c>InvalidRosterInput</c>.</summary>
    public static Gen<IReadOnlyList<TeamRoster>> RostersWithEmptyRoster() =>
        from rosterCount in Gen.Choose(2, 4)
        from rosters in ListOfLength(rosterCount, ValidTeamRoster())
        from emptyIndex in Gen.Choose(0, rosterCount - 1)
        select (IReadOnlyList<TeamRoster>)Replace(rosters, emptyIndex, new TeamRoster(new List<Rating>()));

    // --- Helpers ---

    /// <summary>Builds a generator for a list of exactly <paramref name="length"/> items.</summary>
    private static Gen<List<T>> ListOfLength<T>(int length, Gen<T> element)
    {
        if (length <= 0)
        {
            return Gen.Constant(new List<T>());
        }

        return from head in element
               from tail in ListOfLength(length - 1, element)
               select Prepend(head, tail);
    }

    private static List<T> Prepend<T>(T head, List<T> tail)
    {
        var result = new List<T>(tail.Count + 1) { head };
        result.AddRange(tail);
        return result;
    }

    private static List<T> Replace<T>(List<T> source, int index, T replacement)
    {
        var result = new List<T>(source);
        result[index] = replacement;
        return result;
    }

    private static MatchOutcome ReplaceTeam(List<TeamResult> teams, int index, TeamResult replacement) =>
        new(Replace(teams, index, replacement));

    /// <summary>
    /// Produces a valid outcome shape (2–4 teams, valid ranks) but replaces one player's rating
    /// with a malformed rating drawn from <paramref name="badRating"/>.
    /// </summary>
    private static Gen<MatchOutcome> OutcomeWithInjectedRating(Gen<Rating> badRating) =>
        from teamCount in Gen.Choose(2, 4)
        from teams in ListOfLength(teamCount, ValidTeamResult())
        from badTeamIndex in Gen.Choose(0, teamCount - 1)
        from rating in badRating
        from rank in Gen.Choose(0, 3)
        select ReplaceTeam(
            teams,
            badTeamIndex,
            new TeamResult(new List<PlayerInput> { new(rating) }, rank));
}
