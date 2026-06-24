using FsCheck;
using FsCheck.Xunit;
using PitchMate.Domain.Rating;
using PitchMate.Infrastructure.Tests.Generators;

namespace PitchMate.Infrastructure.Tests.RatingEngine;

/// <summary>
/// Property test for the unified invalid-input rejection behaviour (design Property 22). For every
/// kind of malformed input, the corresponding operation must return the appropriate
/// <see cref="RatingErrorCode"/> and leave every input <see cref="Rating"/> (and the
/// <see cref="RatingEngineConfig"/>) value-for-value unchanged compared to a pre-call snapshot,
/// performing no rating or prediction computation (so reference-typed results are <c>null</c>).
/// </summary>
/// <remarks>
/// Property 22 is implemented as a family of generators, one per error code: each method below pairs a
/// valid configuration with a generator that violates exactly one validation rule and asserts the exact
/// error code is returned with the inputs untouched. The goal-margin lever is exercised via the
/// <c>NegativeMargin</c> case only; because <see cref="MatchOutcome.GoalMargin"/> is modelled as an
/// <see cref="int"/> it is always finite, so the <c>NonFiniteMargin</c> code is structurally unreachable
/// and has no generator. Each property runs a minimum of 100 iterations.
/// </remarks>
public class InvalidInputRejectionPropertyTests
{
    // Feature: rating-engine, Property 22: Invalid inputs are rejected without mutation
    [Property(MaxTest = 100)]
    public Property TooFewTeamsIsRejectedWithoutMutation()
    {
        var gen = from config in RatingGenerators.ValidConfig()
                  from outcome in RatingGenerators.TooFewTeamsOutcome()
                  select (config, outcome);

        return Prop.ForAll(Arb.From(gen), input =>
            UpdateRejects(input.config, input.outcome, RatingErrorCode.TooFewTeams));
    }

    // Feature: rating-engine, Property 22: Invalid inputs are rejected without mutation
    [Property(MaxTest = 100)]
    public Property EmptyTeamIsRejectedWithoutMutation()
    {
        var gen = from config in RatingGenerators.ValidConfig()
                  from outcome in RatingGenerators.EmptyTeamOutcome()
                  select (config, outcome);

        return Prop.ForAll(Arb.From(gen), input =>
            UpdateRejects(input.config, input.outcome, RatingErrorCode.EmptyTeam));
    }

    // Feature: rating-engine, Property 22: Invalid inputs are rejected without mutation
    [Property(MaxTest = 100)]
    public Property NonPositiveSigmaIsRejectedWithoutMutation()
    {
        var gen = from config in RatingGenerators.ValidConfig()
                  from outcome in RatingGenerators.OutcomeWithNonPositiveSigma()
                  select (config, outcome);

        return Prop.ForAll(Arb.From(gen), input =>
            UpdateRejects(input.config, input.outcome, RatingErrorCode.NonPositiveSigma));
    }

    // Feature: rating-engine, Property 22: Invalid inputs are rejected without mutation
    [Property(MaxTest = 100)]
    public Property NonFiniteValueIsRejectedWithoutMutation()
    {
        var gen = from config in RatingGenerators.ValidConfig()
                  from outcome in RatingGenerators.OutcomeWithNonFiniteRating()
                  select (config, outcome);

        return Prop.ForAll(Arb.From(gen), input =>
            UpdateRejects(input.config, input.outcome, RatingErrorCode.NonFiniteValue));
    }

    // Feature: rating-engine, Property 22: Invalid inputs are rejected without mutation
    [Property(MaxTest = 100)]
    public Property NegativeRankIsRejectedWithoutMutation()
    {
        var gen = from config in RatingGenerators.ValidConfig()
                  from outcome in RatingGenerators.NegativeRankOutcome()
                  select (config, outcome);

        return Prop.ForAll(Arb.From(gen), input =>
            UpdateRejects(input.config, input.outcome, RatingErrorCode.NegativeRank));
    }

    // Feature: rating-engine, Property 22: Invalid inputs are rejected without mutation
    [Property(MaxTest = 100)]
    public Property NegativeMarginIsRejectedWithoutMutation()
    {
        // The margin-of-victory lever must be enabled for a malformed goal margin to be inspected; with
        // it disabled the margin is ignored entirely (Requirement 6.2). Participation is left disabled so
        // the margin check is the first lever validation reached.
        var gen = from baseConfig in RatingGenerators.ValidConfig()
                  from outcome in RatingGenerators.NegativeMarginOutcome()
                  let config = baseConfig with
                  {
                      MarginOfVictoryWeightingEnabled = true,
                      ParticipationWeightingEnabled = false,
                  }
                  select (config, outcome);

        return Prop.ForAll(Arb.From(gen), input =>
            UpdateRejects(input.config, input.outcome, RatingErrorCode.NegativeMargin));
    }

    // Feature: rating-engine, Property 22: Invalid inputs are rejected without mutation
    [Property(MaxTest = 100)]
    public Property InvalidParticipationIsRejectedWithoutMutation()
    {
        // The participation lever must be enabled for a malformed participation value to be inspected;
        // with it disabled participation is ignored entirely (Requirement 7.2). The margin lever is left
        // disabled so the participation check is the first lever validation reached.
        var gen = from baseConfig in RatingGenerators.ValidConfig()
                  from outcome in RatingGenerators.InvalidParticipationOutcome()
                  let config = baseConfig with
                  {
                      MarginOfVictoryWeightingEnabled = false,
                      ParticipationWeightingEnabled = true,
                  }
                  select (config, outcome);

        return Prop.ForAll(Arb.From(gen), input =>
            UpdateRejects(input.config, input.outcome, RatingErrorCode.InvalidParticipation));
    }

    // Feature: rating-engine, Property 22: Invalid inputs are rejected without mutation
    [Property(MaxTest = 100)]
    public Property UnknownSkillTierIsRejectedWithoutMutation()
    {
        var gen = from config in RatingGenerators.ValidConfig()
                  from tier in RatingGenerators.UnknownSkillTier()
                  select (config, tier);

        return Prop.ForAll(Arb.From(gen), input =>
        {
            var (config, tier) = input;
            var engine = new PlackettLuceRatingEngine(config);
            var configSnapshot = config with { };

            // CreateRating takes no input rating, so only the config can be observed for mutation.
            var result = engine.CreateRating(tier);

            return Failed(result.IsSuccess, result.Error, RatingErrorCode.UnknownSkillTier)
                && config == configSnapshot;
        });
    }

    // Feature: rating-engine, Property 22: Invalid inputs are rejected without mutation
    [Property(MaxTest = 100)]
    public Property NegativeDurationIsRejectedWithoutMutation()
    {
        var gen = from config in RatingGenerators.ValidConfig()
                  from rating in RatingGenerators.ValidRating()
                  from days in RatingGenerators.NegativeDuration()
                  select (config, rating, days);

        return Prop.ForAll(Arb.From(gen), input =>
        {
            var (config, rating, days) = input;
            var engine = new PlackettLuceRatingEngine(config);
            var configSnapshot = config with { };
            var ratingSnapshot = rating;

            var result = engine.DecayInactivity(rating, days);

            return Failed(result.IsSuccess, result.Error, RatingErrorCode.NegativeDuration)
                && config == configSnapshot
                && RatingEquals(rating, ratingSnapshot);
        });
    }

    // Feature: rating-engine, Property 22: Invalid inputs are rejected without mutation
    [Property(MaxTest = 100)]
    public Property InvalidRosterInputIsRejectedWithoutMutation()
    {
        // Both malformed roster shapes (fewer than two rosters, and any empty roster) map to the single
        // InvalidRosterInput code, so they are covered together here (Requirements 10.7, 12.5).
        var gen = from config in RatingGenerators.ValidConfig()
                  from rosters in Gen.OneOf(
                      RatingGenerators.TooFewRosters(),
                      RatingGenerators.RostersWithEmptyRoster())
                  select (config, rosters);

        return Prop.ForAll(Arb.From(gen), input =>
        {
            var (config, rosters) = input;
            var engine = new PlackettLuceRatingEngine(config);
            var configSnapshot = config with { };
            var ratingSnapshot = SnapshotRosters(rosters);

            var result = engine.Predict(rosters);

            return Failed(result.IsSuccess, result.Error, RatingErrorCode.InvalidRosterInput)
                // A failed prediction returns no probabilities at all (Requirement 10.7).
                && result.Value is null
                && config == configSnapshot
                && RatingsMatch(ratingSnapshot, SnapshotRosters(rosters));
        });
    }

    /// <summary>
    /// Drives <see cref="PlackettLuceRatingEngine.UpdateRatings"/> with a malformed
    /// <paramref name="outcome"/> and asserts it fails with the expected <paramref name="expected"/>
    /// code, returns no <see cref="MatchUpdate"/>, and leaves the config and every input rating unchanged.
    /// </summary>
    private static bool UpdateRejects(RatingEngineConfig config, MatchOutcome outcome, RatingErrorCode expected)
    {
        var engine = new PlackettLuceRatingEngine(config);
        var configSnapshot = config with { };
        var ratingSnapshot = SnapshotRatings(outcome);

        var result = engine.UpdateRatings(outcome);

        return Failed(result.IsSuccess, result.Error, expected)
            // No updated ratings are produced on a validation failure (Requirement 12.7).
            && result.Value is null
            && config == configSnapshot
            && RatingsMatch(ratingSnapshot, SnapshotRatings(outcome));
    }

    /// <summary>A result rejects an input when it failed and carries exactly the expected error code.</summary>
    private static bool Failed(bool isSuccess, RatingError? error, RatingErrorCode expected) =>
        !isSuccess && error is not null && error.Code == expected;

    /// <summary>Captures the (μ, σ) of every player in <paramref name="outcome"/> in input order.</summary>
    private static List<Rating> SnapshotRatings(MatchOutcome outcome)
    {
        var snapshot = new List<Rating>();
        foreach (var team in outcome.Teams)
        {
            foreach (var player in team.Players)
            {
                snapshot.Add(player.Rating);
            }
        }

        return snapshot;
    }

    /// <summary>Captures the (μ, σ) of every player across <paramref name="rosters"/> in input order.</summary>
    private static List<Rating> SnapshotRosters(IReadOnlyList<TeamRoster> rosters)
    {
        var snapshot = new List<Rating>();
        foreach (var roster in rosters)
        {
            foreach (var rating in roster.Players)
            {
                snapshot.Add(rating);
            }
        }

        return snapshot;
    }

    /// <summary>Compares two ordered rating snapshots value-for-value.</summary>
    private static bool RatingsMatch(IReadOnlyList<Rating> expected, IReadOnlyList<Rating> actual)
    {
        if (expected.Count != actual.Count)
        {
            return false;
        }

        for (var i = 0; i < expected.Count; i++)
        {
            if (!RatingEquals(expected[i], actual[i]))
            {
                return false;
            }
        }

        return true;
    }

    /// <summary>Exact value equality of two ratings (NaN-safe via <see cref="double.Equals(double)"/>).</summary>
    private static bool RatingEquals(Rating a, Rating b) =>
        a.Mu.Equals(b.Mu) && a.Sigma.Equals(b.Sigma);
}
