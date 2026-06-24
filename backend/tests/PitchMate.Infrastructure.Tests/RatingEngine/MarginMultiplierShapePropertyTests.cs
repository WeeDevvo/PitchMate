using FsCheck;
using FsCheck.Xunit;
using PitchMate.Domain.Rating;
using PitchMate.Infrastructure.Tests.Generators;

namespace PitchMate.Infrastructure.Tests.RatingEngine;

/// <summary>
/// Property test for the shape of the margin-of-victory multiplier applied by
/// <see cref="PlackettLuceRatingEngine.UpdateRatings"/> when the lever is ENABLED. The multiplier
/// <c>m(g) = 1 + (MarginMultiplierMax − 1)·g / (g + 1)</c> scales each player's mean shift
/// <c>(μ′ − μ)</c>, so it is observed here through a clean identical-ratings rank win: the winning
/// team's single player has a strictly positive base mean shift, and dividing the margin-adjusted
/// shift by that base shift recovers the effective multiplier <c>m(g)</c> the engine applied.
///
/// The recovered multiplier must, for finite, equally-spaced goal margins 0 ≤ a &lt; b &lt; c (so
/// b − a = c − b), be bounded in <c>[1.0, MarginMultiplierMax]</c>, non-decreasing
/// (<c>m(a) ≤ m(b) ≤ m(c)</c>), have diminishing increments (<c>m(b) − m(a) ≥ m(c) − m(b)</c>), and
/// satisfy <c>m(0) = 1.0</c> — the last verified exactly by comparing the margin-zero update against
/// the disabled-lever update (Requirements 6.3, 6.4, 6.5).
///
/// The diminishing-increment (concavity) check compares increments over equal margin steps because
/// "the per-goal increment diminishes as the goal margin grows" (Requirement 6.3) is a statement
/// about successive equal-width steps; over unequal spans a wider later step can legitimately add
/// more than a narrower earlier one even though the function is concave.
/// </summary>
public class MarginMultiplierShapePropertyTests
{
    // Feature: rating-engine, Property 14: The margin multiplier is bounded, concave, and unit at zero
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(RatingArbitraries) })]
    public Property MarginMultiplierIsBoundedConcaveAndUnitAtZero(
        RatingEngineConfig baseConfig,
        int muSeed,
        int sigmaSeed,
        int marginSeed,
        int stepSeed,
        int maxSeed)
    {
        // Enable the lever and pin a meaningful cap strictly above 1.0 (in [1.1, 3.0]) so the
        // multiplier genuinely varies with the margin and the monotonicity / concavity are exercised.
        // The property still holds for a cap of exactly 1.0 (m ≡ 1), but a varying cap is a stronger test.
        var marginMax = 1.0 + (1 + Math.Abs(maxSeed % 20)) / 10.0;
        var enabledConfig = baseConfig with
        {
            MarginOfVictoryWeightingEnabled = true,
            MarginMultiplierMax = marginMax
        };
        var disabledConfig = enabledConfig with { MarginOfVictoryWeightingEnabled = false };

        var enabledEngine = new PlackettLuceRatingEngine(enabledConfig);
        var disabledEngine = new PlackettLuceRatingEngine(disabledConfig);

        // A healthy identical rating (σ well above zero) so the winning team's base mean shift is
        // comfortably non-zero and the recovered multiplier is numerically stable.
        var mu = (muSeed % 41) - 20;                 // μ in [-20, 20]
        var sigma = 2.0 + Math.Abs(sigmaSeed % 19);  // σ in [2, 20]
        var shared = new Rating(mu, sigma);

        // Three finite goal margins, equally spaced so 0 ≤ a < b < c with b − a = c − b. Equal spacing
        // is what the diminishing-increment (concavity) check below requires (Requirement 6.3). a may be
        // zero; the step is strictly positive so the three margins are distinct and ordered.
        var a = Math.Abs(marginSeed % 500);
        var step = 1 + Math.Abs(stepSeed % 500);
        var b = a + step;
        var c = b + step;

        // A 1v1 of identical ratings where team A (index 0) is ranked strictly better (rank 0) than
        // team B (rank 1). The winning team's μ strictly increases, giving a positive base mean shift.
        MatchOutcome OutcomeWithMargin(int margin) => new(
            new List<TeamResult>
            {
                new(new List<PlayerInput> { new(shared) }, Rank: 0),
                new(new List<PlayerInput> { new(shared) }, Rank: 1)
            },
            GoalMargin: margin);

        var disabledUpdate = disabledEngine.UpdateRatings(OutcomeWithMargin(0));
        var updateZero = enabledEngine.UpdateRatings(OutcomeWithMargin(0));
        var updateA = enabledEngine.UpdateRatings(OutcomeWithMargin(a));
        var updateB = enabledEngine.UpdateRatings(OutcomeWithMargin(b));
        var updateC = enabledEngine.UpdateRatings(OutcomeWithMargin(c));

        // All five structurally-valid updates must succeed.
        if (!disabledUpdate.IsSuccess || !updateZero.IsSuccess ||
            !updateA.IsSuccess || !updateB.IsSuccess || !updateC.IsSuccess)
        {
            return false.ToProperty();
        }

        // m(0) = 1.0: with margin zero the multiplier is unit, so the enabled update must equal the
        // disabled update exactly, value-for-value (Requirement 6.5).
        var winnerZero = updateZero.Value!.Teams[0][0];
        var winnerDisabled = disabledUpdate.Value!.Teams[0][0];
        var unitAtZero = winnerZero.Mu == winnerDisabled.Mu && winnerZero.Sigma == winnerDisabled.Sigma;

        // Base (unscaled) mean shift of the winning player, taken from the margin-zero update since
        // m(0) = 1. Guard against the degenerate near-zero shift that would make the division unstable.
        var baseShift = winnerZero.Mu - mu;
        if (Math.Abs(baseShift) < 1e-9)
        {
            return unitAtZero.ToProperty();
        }

        // Recover the effective multiplier the engine applied at each margin.
        double Multiplier(MatchUpdate update) => (update.Teams[0][0].Mu - mu) / baseShift;

        var mA = Multiplier(updateA.Value!);
        var mB = Multiplier(updateB.Value!);
        var mC = Multiplier(updateC.Value!);

        const double tol = 1e-6;

        // Bounded: 1.0 ≤ m(g) ≤ MarginMultiplierMax for every margin (Requirement 6.4).
        var bounded =
            mA >= 1.0 - tol && mA <= marginMax + tol &&
            mB >= 1.0 - tol && mB <= marginMax + tol &&
            mC >= 1.0 - tol && mC <= marginMax + tol;

        // Non-decreasing in the goal margin (Requirement 6.3).
        var nonDecreasing = mA <= mB + tol && mB <= mC + tol;

        // Diminishing per-goal increments: the gain from a→b is at least the gain from b→c
        // (concavity, Requirement 6.3).
        var diminishing = (mB - mA) >= (mC - mB) - tol;

        return (unitAtZero && bounded && nonDecreasing && diminishing).ToProperty();
    }
}
