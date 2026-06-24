using FsCheck;
using FsCheck.Xunit;
using PitchMate.Domain.Rating;
using PitchMate.Infrastructure.Tests.Generators;

namespace PitchMate.Infrastructure.Tests.RatingEngine;

/// <summary>
/// Property test for margin-of-victory neutrality on <see cref="PlackettLuceRatingEngine.UpdateRatings"/>.
/// With margin-of-victory weighting DISABLED (the shipped default), the goal margin must have no effect:
/// updating a <see cref="MatchOutcome"/> that carries a goal margin must produce μ/σ results that are
/// exactly equal, value-for-value, to updating the same outcome with no goal margin supplied
/// (Requirement 6.2).
/// </summary>
public class DisabledMarginNeutralityPropertyTests
{
    // Feature: rating-engine, Property 13: Margin-of-victory weighting is neutral when disabled
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(RatingArbitraries) })]
    public Property MarginOfVictoryWeightingIsNeutralWhenDisabled(
        RatingEngineConfig config,
        MatchOutcome outcome,
        int rawMargin)
    {
        // Force the lever off regardless of what the config generator produced. The default is already
        // false, but pinning it here makes the "disabled" precondition explicit (Requirement 6.1/6.2).
        var disabledConfig = config with { MarginOfVictoryWeightingEnabled = false };
        var engine = new PlackettLuceRatingEngine(disabledConfig);

        // Any finite, non-negative goal margin. GoalMargin is an int, so it is always finite; the
        // absolute value keeps it non-negative without discarding generated magnitudes. int.MinValue
        // has no positive counterpart, so it is mapped to int.MaxValue to avoid overflow.
        var goalMargin = rawMargin == int.MinValue ? int.MaxValue : Math.Abs(rawMargin);

        var withMargin = engine.UpdateRatings(outcome with { GoalMargin = goalMargin });
        var withoutMargin = engine.UpdateRatings(outcome with { GoalMargin = null });

        // A valid outcome updates successfully in both cases; the goal margin must not change that.
        if (!withMargin.IsSuccess || !withoutMargin.IsSuccess)
        {
            return false.ToProperty();
        }

        // Disabled weighting => bit-identical results, so compare μ/σ with exact equality (not a
        // tolerance): the goal margin must be ignored entirely (Requirement 6.2).
        return ResultsExactlyEqual(withMargin.Value!, withoutMargin.Value!).ToProperty();
    }

    /// <summary>
    /// True when two <see cref="MatchUpdate"/>s have the same team/player shape and every corresponding
    /// rating is equal value-for-value (exact μ and σ equality).
    /// </summary>
    private static bool ResultsExactlyEqual(MatchUpdate left, MatchUpdate right)
    {
        if (left.Teams.Count != right.Teams.Count)
        {
            return false;
        }

        for (var i = 0; i < left.Teams.Count; i++)
        {
            var leftTeam = left.Teams[i];
            var rightTeam = right.Teams[i];

            if (leftTeam.Count != rightTeam.Count)
            {
                return false;
            }

            for (var j = 0; j < leftTeam.Count; j++)
            {
                // Exact equality: the disabled lever path performs no margin-dependent arithmetic, so
                // the two updates must be identical down to the bit.
                if (leftTeam[j].Mu != rightTeam[j].Mu || leftTeam[j].Sigma != rightTeam[j].Sigma)
                {
                    return false;
                }
            }
        }

        return true;
    }
}
