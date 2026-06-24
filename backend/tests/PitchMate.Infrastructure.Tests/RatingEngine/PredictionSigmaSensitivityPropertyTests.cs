using FsCheck;
using FsCheck.Xunit;
using PitchMate.Domain.Rating;

namespace PitchMate.Infrastructure.Tests.RatingEngine;

/// <summary>
/// Property test for the σ-sensitivity of <see cref="PlackettLuceRatingEngine.Predict"/>. The
/// prediction must consume both the μ <em>and</em> the σ of every roster (Requirement 10.2), so
/// changing the σ of one roster while holding every μ fixed must observably change the returned win
/// probabilities.
///
/// <para>
/// The generator (<see cref="SigmaSensitivityArbitraries"/>) is deliberately constrained so the
/// change is provably observable across all 100 iterations:
/// </para>
/// <list type="bullet">
///   <item>Each team is given a <em>distinct</em> aggregate μ (strictly-increasing per-team means
///   with equal player counts), so the win probabilities are not the symmetric 50/50 point where a
///   σ change cancels out under normalisation.</item>
///   <item>Means, β, and σ are kept in a modest range so the underlying Φ stays in its sensitive
///   region (away from saturation at 0.0/1.0), where a denominator change moves the probability.</item>
///   <item>The σ change is applied <em>asymmetrically</em> — only to the first roster — and is a
///   meaningful additive delta, so the aggregate team variance provably changes.</item>
/// </list>
/// Every μ is held byte-for-byte identical between the baseline and modified roster sets, so any
/// change in the win probabilities is attributable solely to σ.
/// </summary>
public class PredictionSigmaSensitivityPropertyTests
{
    // Feature: rating-engine, Property 20: Prediction uses σ as well as μ
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(SigmaSensitivityArbitraries) })]
    public Property PredictionUsesSigmaAsWellAsMu(SigmaSensitivityScenario scenario)
    {
        var engine = new PlackettLuceRatingEngine(scenario.Config);

        var baseline = engine.Predict(scenario.Baseline);
        var modified = engine.Predict(scenario.Modified);

        // Both roster sets are valid (2+ non-empty rosters of finite, σ > 0 ratings), so prediction
        // must succeed in both cases (Requirement 10.1).
        if (!baseline.IsSuccess || !modified.IsSuccess)
        {
            return false.ToProperty();
        }

        var baseWins = baseline.Value!.WinProbabilities;
        var modWins = modified.Value!.WinProbabilities;

        // Same shape: changing σ never changes the number of teams.
        if (baseWins.Count != modWins.Count)
        {
            return false.ToProperty();
        }

        // The win probabilities must differ beyond floating-point noise: σ genuinely participates in
        // the prediction (Requirement 10.2). Floating-point noise for these computations is ~1e-15;
        // the constrained generator yields differences orders of magnitude above the 1e-9 guard.
        var maxAbsoluteDifference = baseWins
            .Zip(modWins, (b, m) => Math.Abs(b - m))
            .Max();

        return (maxAbsoluteDifference > 1e-9).ToProperty();
    }
}

/// <summary>
/// A single σ-sensitivity scenario: a valid config plus two roster sets that share identical μ
/// values but differ in the σ of the first roster.
/// </summary>
public sealed record SigmaSensitivityScenario(
    RatingEngineConfig Config,
    IReadOnlyList<TeamRoster> Baseline,
    IReadOnlyList<TeamRoster> Modified);

/// <summary>
/// FsCheck arbitrary producing <see cref="SigmaSensitivityScenario"/> values. Reference it from the
/// property via <c>[Property(Arbitrary = new[] { typeof(SigmaSensitivityArbitraries) })]</c>.
/// </summary>
public static class SigmaSensitivityArbitraries
{
    public static Arbitrary<SigmaSensitivityScenario> SigmaSensitivityScenario() =>
        Arb.From(Generator());

    private static Gen<SigmaSensitivityScenario> Generator() =>
        // 2–4 teams, an equal player count per team (so distinct per-team means give distinct
        // aggregate means), and the structural inputs that keep Φ in its sensitive region.
        from teamCount in Gen.Choose(2, 4)
        from playersPerTeam in Gen.Choose(1, 2)
        // Strictly-increasing per-team means via a base mean plus positive gaps, keeping the spread
        // modest so the underlying Φ does not saturate.
        from baseMeanMilli in Gen.Choose(-3_000, 3_000)
        from gapMillis in GenArrayOfLength(teamCount - 1, Gen.Choose(1_000, 3_000))
        // Per-player σ in a moderate range [1, 6]; the first roster's σ is shifted by a clear +4.0.
        from sigmaMillis in GenArrayOfLength(
            teamCount * playersPerTeam,
            Gen.Choose(1_000, 6_000))
        select BuildScenario(teamCount, playersPerTeam, baseMeanMilli, gapMillis, sigmaMillis);

    private static SigmaSensitivityScenario BuildScenario(
        int teamCount,
        int playersPerTeam,
        int baseMeanMilli,
        int[] gapMillis,
        int[] sigmaMillis)
    {
        // Distinct, strictly-increasing aggregate means: team 0 sits at baseMean, each subsequent
        // team adds a positive gap. Equal player counts keep the aggregate means distinct.
        var teamMeans = new double[teamCount];
        teamMeans[0] = baseMeanMilli / 1000.0;
        for (var i = 1; i < teamCount; i++)
        {
            teamMeans[i] = teamMeans[i - 1] + (gapMillis[i - 1] / 1000.0);
        }

        const double sigmaDelta = 4.0;
        var baseline = new List<TeamRoster>(teamCount);
        var modified = new List<TeamRoster>(teamCount);
        var sigmaIndex = 0;

        for (var team = 0; team < teamCount; team++)
        {
            var baselinePlayers = new List<Rating>(playersPerTeam);
            var modifiedPlayers = new List<Rating>(playersPerTeam);

            for (var p = 0; p < playersPerTeam; p++)
            {
                var mu = teamMeans[team];
                var sigma = sigmaMillis[sigmaIndex++] / 1000.0;

                baselinePlayers.Add(new Rating(mu, sigma));

                // μ is held identical; only the first roster's σ is changed (asymmetric change).
                var modifiedSigma = team == 0 ? sigma + sigmaDelta : sigma;
                modifiedPlayers.Add(new Rating(mu, modifiedSigma));
            }

            baseline.Add(new TeamRoster(baselinePlayers));
            modified.Add(new TeamRoster(modifiedPlayers));
        }

        // A controlled, valid config: the documented defaults give a well-behaved β (≈4.17) that
        // keeps Φ in its sensitive region for the modest means above.
        var config = new RatingEngineConfig();

        return new SigmaSensitivityScenario(config, baseline, modified);
    }

    /// <summary>Builds a generator for an array of exactly <paramref name="length"/> items.</summary>
    private static Gen<int[]> GenArrayOfLength(int length, Gen<int> element)
    {
        if (length <= 0)
        {
            return Gen.Constant(Array.Empty<int>());
        }

        return from head in element
               from tail in GenArrayOfLength(length - 1, element)
               select Prepend(head, tail);
    }

    private static int[] Prepend(int head, int[] tail)
    {
        var result = new int[tail.Length + 1];
        result[0] = head;
        Array.Copy(tail, 0, result, 1, tail.Length);
        return result;
    }
}
