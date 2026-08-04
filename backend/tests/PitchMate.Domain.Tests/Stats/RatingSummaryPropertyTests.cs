using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Domain.Rating;
using PitchMate.Domain.Stats;
using PlayerRating = PitchMate.Domain.Rating.Rating;

namespace PitchMate.Domain.Tests.Stats;

/// <summary>
/// Property-based tests for the read-shaping <see cref="RatingSummary"/> (stats-and-summaries design
/// Property 8).
/// <para>
/// For any membership, when it has a rating the summary reports the same μ/σ and the state from
/// <see cref="IRatingEngine.GetState"/>; when it has no rating the summary is not-yet-established with
/// no μ/σ pair, no state, and no display rating; and the not-yet-established report is distinguishable
/// from a provisional report, which carries μ/σ and a <see cref="RatingState.Provisional"/> state but
/// no display rating (Requirement 7.1, 7.7). The property runs at least 100 iterations.
/// </para>
/// </summary>
[Trait("Feature", "stats-and-summaries")]
public class RatingSummaryPropertyTests
{
    // Feature: stats-and-summaries, Property 8: Rating reporting distinguishes not-yet-established from
    // provisional - when a membership has a Membership_Rating the reported μ/σ equal that rating and the
    // state equals IRatingEngine.GetState; when it has none the rating is not-yet-established with no
    // μ/σ, no Rating_State, and no Display_Rating, distinguishable from a Provisional report that
    // carries μ/σ and a Provisional state but no Display_Rating.
    // Validates: Requirements 7.1, 7.7
    [Property(MaxTest = 100)]
    [Trait("Property", "8")]
    public Property SummaryDistinguishesNotYetEstablishedFromProvisional() =>
        Prop.ForAll(Arb.From(ScenarioGen()), scenario =>
        {
            var engine = new ThresholdRatingEngine(scenario.ProvisionalThreshold);
            var parameters = DisplayRatingParameters.Default;

            var notYetEstablished = RatingSummary.NotYetEstablished;

            // Not-yet-established: all four values absent (Requirement 7.7).
            var notYetEstablishedShape =
                notYetEstablished.Mu is null
                && notYetEstablished.Sigma is null
                && notYetEstablished.State is null
                && notYetEstablished.DisplayRating is null;
            if (!notYetEstablishedShape)
            {
                return false;
            }

            var summary = RatingSummary.FromRating(engine, scenario.Mu, scenario.Sigma, parameters);
            var expectedState = engine.GetState(new PlayerRating(scenario.Mu, scenario.Sigma)).Value;

            // A membership with a rating reports that rating's μ/σ and the engine's state (Requirement 7.1, 7.2).
            var reportsRating =
                summary.Mu == scenario.Mu
                && summary.Sigma == scenario.Sigma
                && summary.State == expectedState;
            if (!reportsRating)
            {
                return false;
            }

            if (expectedState == RatingState.Provisional)
            {
                // Provisional: μ/σ and a Provisional state, but no display rating, and it is
                // distinguishable from the not-yet-established report (which has a null state).
                var provisionalShape =
                    summary is { State: RatingState.Provisional, DisplayRating: null }
                    && summary.State != notYetEstablished.State
                    && summary.Mu is not null
                    && summary.Sigma is not null;
                return provisionalShape;
            }

            // Established: all four values present.
            return summary is { Mu: not null, Sigma: not null, State: RatingState.Established, DisplayRating: not null };
        });

    // ---- Generators -----------------------------------------------------------------------------

    /// <summary>A generated rating scenario: a rating (μ, σ) and the σ threshold used to classify it.</summary>
    private sealed record Scenario(double Mu, double Sigma, double ProvisionalThreshold);

    /// <summary>
    /// Generates a rating with σ spanning below and above the threshold so both the provisional and
    /// established branches arise; μ is bounded so an established display rating is a sane whole number.
    /// </summary>
    private static Gen<Scenario> ScenarioGen() =>
        from mu in Gen.Choose(0, 5000).Select(i => i / 100.0)         // 0.00 .. 50.00
        from sigma in Gen.Choose(1, 1500).Select(i => i / 100.0)       // 0.01 .. 15.00
        from threshold in Gen.Choose(100, 900).Select(i => i / 100.0)  // 1.00 .. 9.00
        select new Scenario(mu, sigma, threshold);
}
