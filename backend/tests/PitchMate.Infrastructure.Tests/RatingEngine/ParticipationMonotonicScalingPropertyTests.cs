using FsCheck;
using FsCheck.Xunit;
using PitchMate.Domain.Rating;
using PitchMate.Infrastructure.Tests.Generators;

namespace PitchMate.Infrastructure.Tests.RatingEngine;

/// <summary>
/// Property test for the participation lever's monotonic scaling on
/// <see cref="PlackettLuceRatingEngine.UpdateRatings"/> when the lever is ENABLED. The lever
/// interpolates each player's update back toward their input rating by their participation value
/// <c>p ∈ [0, 1]</c>: <c>μ″ = μ + p·(μ′ − μ)</c>, <c>σ″ = σ + p·(σ′ − σ)</c>. This gives the three
/// behaviours asserted here, observed over the same valid <see cref="MatchOutcome"/>:
///
/// <list type="bullet">
///   <item><c>p = 1.0</c> for every player reproduces the base (disabled-lever) update — the
///   interpolation collapses to the base shift (Requirement 7.4).</item>
///   <item><c>p = 0.0</c> for every player leaves each player's μ and σ exactly equal to their input
///   rating — the interpolation collapses to zero shift (Requirement 7.5).</item>
///   <item>For two participation values <c>p1 ≤ p2</c>, the magnitude of the μ shift
///   <c>|μ″ − μ|</c> at <c>p2</c> is at least its magnitude at <c>p1</c> (the factor increases
///   monotonically in <c>p</c>, Requirement 7.3).</item>
/// </list>
///
/// The base update is obtained from a lever-disabled engine over the same outcome; with the lever
/// disabled the participation values are ignored entirely (Property 15), so it is exactly the
/// PlackettLuce update the enabled lever interpolates toward.
/// </summary>
public class ParticipationMonotonicScalingPropertyTests
{
    // Feature: rating-engine, Property 16: Participation scales the update monotonically between its endpoints
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(RatingArbitraries) })]
    public Property ParticipationScalesTheUpdateMonotonicallyBetweenItsEndpoints(
        RatingEngineConfig baseConfig,
        MatchOutcome outcome,
        int p1Seed,
        int p2Seed)
    {
        // Enable the participation lever for the engine under test; pin a lever-disabled twin to
        // compute the base update the interpolation collapses toward (Requirement 7.4). The margin
        // lever is irrelevant here: the generated outcome carries no goal margin, so even if the base
        // config left margin weighting enabled, the margin path is a no-op (multiplier 1.0).
        var enabledConfig = baseConfig with { ParticipationWeightingEnabled = true };
        var disabledConfig = baseConfig with { ParticipationWeightingEnabled = false };

        var enabledEngine = new PlackettLuceRatingEngine(enabledConfig);
        var disabledEngine = new PlackettLuceRatingEngine(disabledConfig);

        // Two participation values in [0, 1], ordered p1 ≤ p2, for the monotonicity check.
        var pA = (Math.Abs(p1Seed % 1001)) / 1000.0;
        var pB = (Math.Abs(p2Seed % 1001)) / 1000.0;
        var p1 = Math.Min(pA, pB);
        var p2 = Math.Max(pA, pB);

        // The base (disabled-lever) update. The generated outcome supplies no participation, so the
        // disabled engine accepts it and returns the plain PlackettLuce update (Requirement 7.2).
        var baseUpdate = disabledEngine.UpdateRatings(outcome);

        // Enabled-lever updates at the two endpoints and at the two ordered interior points. Each
        // assigns a uniform participation value to every player so the per-player interpolation is
        // exercised across the whole outcome.
        var updateAtOne = enabledEngine.UpdateRatings(WithUniformParticipation(outcome, 1.0));
        var updateAtZero = enabledEngine.UpdateRatings(WithUniformParticipation(outcome, 0.0));
        var updateAtP1 = enabledEngine.UpdateRatings(WithUniformParticipation(outcome, p1));
        var updateAtP2 = enabledEngine.UpdateRatings(WithUniformParticipation(outcome, p2));

        // A valid outcome updates successfully in every case; the participation value must not change
        // that.
        if (!baseUpdate.IsSuccess || !updateAtOne.IsSuccess || !updateAtZero.IsSuccess ||
            !updateAtP1.IsSuccess || !updateAtP2.IsSuccess)
        {
            return false.ToProperty();
        }

        var tolerance = enabledConfig.NumericTolerance;

        // p = 1: reproduces the base update. The interpolation μ + 1·(μ′ − μ) reconstructs μ′ up to a
        // rounding error, so compare within the configured numeric tolerance (Requirement 7.4).
        var oneReproducesBase = TeamsApproximatelyEqual(
            updateAtOne.Value!,
            baseUpdate.Value!,
            tolerance);

        // p = 0: leaves every player's μ and σ exactly equal to their input. The interpolation
        // μ + 0·(μ′ − μ) is exactly μ in floating point, so assert exact equality (Requirement 7.5).
        var zeroLeavesInputUnchanged = TeamsExactlyEqualInputs(updateAtZero.Value!, outcome);

        // Monotonic μ shift: with p1 ≤ p2, every player's |μ″ − μ| at p2 is ≥ its magnitude at p1
        // (Requirement 7.3). Compared within tolerance to absorb floating-point noise.
        var muShiftMonotonic = MuShiftMagnitudeNonDecreasing(
            updateAtP1.Value!,
            updateAtP2.Value!,
            outcome,
            tolerance);

        return (oneReproducesBase && zeroLeavesInputUnchanged && muShiftMonotonic).ToProperty();
    }

    /// <summary>
    /// Returns a copy of <paramref name="outcome"/> in which every player carries the same
    /// participation value <paramref name="p"/>, leaving ratings, ranks, and ordering intact.
    /// </summary>
    private static MatchOutcome WithUniformParticipation(MatchOutcome outcome, double p)
    {
        var teams = outcome.Teams
            .Select(team => team with
            {
                Players = team.Players
                    .Select(player => player with { Participation = p })
                    .ToList()
            })
            .ToList();

        return outcome with { Teams = teams };
    }

    /// <summary>
    /// True when two updates share the same team/player shape and every corresponding μ and σ are
    /// equal within <paramref name="tolerance"/>.
    /// </summary>
    private static bool TeamsApproximatelyEqual(MatchUpdate left, MatchUpdate right, double tolerance)
    {
        if (left.Teams.Count != right.Teams.Count)
        {
            return false;
        }

        for (var i = 0; i < left.Teams.Count; i++)
        {
            if (left.Teams[i].Count != right.Teams[i].Count)
            {
                return false;
            }

            for (var j = 0; j < left.Teams[i].Count; j++)
            {
                if (Math.Abs(left.Teams[i][j].Mu - right.Teams[i][j].Mu) > tolerance ||
                    Math.Abs(left.Teams[i][j].Sigma - right.Teams[i][j].Sigma) > tolerance)
                {
                    return false;
                }
            }
        }

        return true;
    }

    /// <summary>
    /// True when every updated rating equals its corresponding input rating exactly (μ and σ),
    /// preserving team and player ordering.
    /// </summary>
    private static bool TeamsExactlyEqualInputs(MatchUpdate update, MatchOutcome outcome)
    {
        if (update.Teams.Count != outcome.Teams.Count)
        {
            return false;
        }

        for (var i = 0; i < update.Teams.Count; i++)
        {
            var updatedTeam = update.Teams[i];
            var inputPlayers = outcome.Teams[i].Players;

            if (updatedTeam.Count != inputPlayers.Count)
            {
                return false;
            }

            for (var j = 0; j < updatedTeam.Count; j++)
            {
                var input = inputPlayers[j].Rating;

                // Exact equality: μ + 0·(μ′ − μ) = μ and σ + 0·(σ′ − σ) = σ in floating point.
                if (updatedTeam[j].Mu != input.Mu || updatedTeam[j].Sigma != input.Sigma)
                {
                    return false;
                }
            }
        }

        return true;
    }

    /// <summary>
    /// True when, for every player, the magnitude of the μ shift from the input rating at the larger
    /// participation (<paramref name="atP2"/>) is at least its magnitude at the smaller participation
    /// (<paramref name="atP1"/>), within <paramref name="tolerance"/>.
    /// </summary>
    private static bool MuShiftMagnitudeNonDecreasing(
        MatchUpdate atP1,
        MatchUpdate atP2,
        MatchOutcome outcome,
        double tolerance)
    {
        for (var i = 0; i < outcome.Teams.Count; i++)
        {
            var inputPlayers = outcome.Teams[i].Players;

            for (var j = 0; j < inputPlayers.Count; j++)
            {
                var inputMu = inputPlayers[j].Rating.Mu;
                var shiftAtP1 = Math.Abs(atP1.Teams[i][j].Mu - inputMu);
                var shiftAtP2 = Math.Abs(atP2.Teams[i][j].Mu - inputMu);

                if (shiftAtP2 < shiftAtP1 - tolerance)
                {
                    return false;
                }
            }
        }

        return true;
    }
}
