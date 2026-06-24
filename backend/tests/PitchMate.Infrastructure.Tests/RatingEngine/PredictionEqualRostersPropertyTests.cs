using FsCheck;
using FsCheck.Xunit;
using PitchMate.Domain.Rating;
using PitchMate.Infrastructure.Tests.Generators;

namespace PitchMate.Infrastructure.Tests.RatingEngine;

/// <summary>
/// Property test for symmetry of <see cref="PlackettLuceRatingEngine.Predict"/> across rosters that
/// hold the same multiset of ratings. Two rosters with the same number of players and the same
/// ratings (possibly reordered) describe equally-strong teams, so the engine must assign them equal
/// win probabilities. Player order within a roster, and the presence of other arbitrary rosters in the
/// match, must not break that equality (Requirement 10.5).
/// </summary>
public class PredictionEqualRostersPropertyTests
{
    // Feature: rating-engine, Property 21: Equal rosters receive equal win probabilities
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(RatingArbitraries) })]
    public Property EqualRostersReceiveEqualWinProbabilities(
        RatingEngineConfig config,
        TeamRoster rosterA,
        Rating[] extraRatings,
        int seed)
    {
        var engine = new PlackettLuceRatingEngine(config);

        // Roster B holds the SAME multiset of ratings as roster A, deterministically shuffled so the
        // two rosters differ only in player order. A reordered multiset must predict identically.
        var shuffled = Shuffle(rosterA.Players, seed);
        var rosterB = new TeamRoster(shuffled);

        // Build a prediction containing both rosters. Optionally include one extra arbitrary roster so
        // the equality holds in a multi-roster field, not just a head-to-head pair. The extra roster is
        // only added when at least one rating was generated for it (Predict requires non-empty rosters).
        var rosters = new List<TeamRoster> { rosterA, rosterB };
        if (extraRatings.Length > 0)
        {
            rosters.Add(new TeamRoster(extraRatings));
        }

        var result = engine.Predict(rosters);

        // A valid set of two-or-more non-empty rosters always predicts successfully (Requirement 10.1).
        if (!result.IsSuccess)
        {
            return false.ToProperty();
        }

        // Roster A is at index 0 and roster B at index 1; their win probabilities must be equal
        // (Requirement 10.5). The comparison uses a small floating-point epsilon rather than the
        // config's NumericTolerance: the two-team closed form returns {p, 1 - p} with p = Φ(0), and
        // the engine's Φ is backed by a documented rational erfc approximation (fractional error
        // ~1.2e-7), so equal rosters agree only to that numerical precision, not to 1e-9. This epsilon
        // reflects the prediction method's precision and is unrelated to the tighter NumericTolerance
        // that governs the normalisation-sum invariant.
        const double epsilon = 1e-6;
        var probabilities = result.Value!.WinProbabilities;
        var equalWithinTolerance =
            Math.Abs(probabilities[0] - probabilities[1]) <= epsilon;

        return equalWithinTolerance.ToProperty();
    }

    /// <summary>
    /// Returns a deterministic permutation of <paramref name="source"/> driven by <paramref name="seed"/>
    /// (Fisher-Yates). The result is always the same multiset, only reordered, so it is a valid roster
    /// carrying identical ratings.
    /// </summary>
    private static List<Rating> Shuffle(IReadOnlyList<Rating> source, int seed)
    {
        var items = new List<Rating>(source);
        var random = new System.Random(seed);
        for (var i = items.Count - 1; i > 0; i--)
        {
            var j = random.Next(i + 1);
            (items[i], items[j]) = (items[j], items[i]);
        }

        return items;
    }
}
