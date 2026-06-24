namespace PitchMate.Domain.Rating;

/// <summary>
/// The pure, deterministic rating engine that converts ranked match outcomes into player
/// skill ratings (μ, σ). Every operation is a pure function: equal inputs always produce
/// byte-identical outputs.
/// </summary>
/// <remarks>
/// The engine has no side effects and no awareness of the outside world: no persistence,
/// no system clock, no randomness, and no I/O. All model parameters (means, uncertainties,
/// thresholds, decay rates, and the switchable weighting levers) come from an injected
/// <see cref="RatingEngineConfig"/>. Because the engine is pure and holds no mutable state,
/// the single <see cref="UpdateRatings"/> code path serves both live match-completion and
/// bulk replay, and a single instance is safe to share as a singleton.
/// Every fallible operation returns a <see cref="Result{T}"/> carrying either a value or a
/// typed <see cref="RatingError"/>; expected validation failures never throw. When the
/// injected configuration is invalid, every operation returns the configuration error and
/// performs no rating computation.
/// </remarks>
public interface IRatingEngine
{
    /// <summary>
    /// Produces a cold-start rating for a new player. The μ is seeded from the supplied
    /// <paramref name="tier"/>, or the configured default mean when <paramref name="tier"/>
    /// is <c>null</c>; σ is always the configured initial uncertainty. An unrecognized tier
    /// yields an error and no rating.
    /// </summary>
    /// <param name="tier">The optional seeding skill tier; <c>null</c> uses the default mean.</param>
    /// <returns>A success carrying the seeded <see cref="Rating"/>, or a validation error.</returns>
    Result<Rating> CreateRating(SkillTier? tier = null);

    /// <summary>
    /// Classifies a rating as Provisional or Established based on its σ relative to the
    /// configured provisional threshold: σ strictly above the threshold is Provisional;
    /// σ at or below the threshold (including σ = 0) is Established.
    /// </summary>
    /// <param name="rating">The rating to classify.</param>
    /// <returns>A success carrying the <see cref="RatingState"/>, or a validation error.</returns>
    Result<RatingState> GetState(Rating rating);

    /// <summary>
    /// THE single rating-update operation. Applies the PlackettLuce update over the N ranked
    /// teams of the supplied <paramref name="outcome"/>, applying the margin-of-victory and
    /// participation levers only when enabled in configuration. All input is validated before
    /// any computation; the output preserves the input team and player ordering. Used by both
    /// match-completion and each step of <see cref="Replay"/>.
    /// </summary>
    /// <param name="outcome">The completed match: two or more ranked team results.</param>
    /// <returns>A success carrying the <see cref="MatchUpdate"/>, or a validation error.</returns>
    Result<MatchUpdate> UpdateRatings(MatchOutcome outcome);

    /// <summary>
    /// Replays an ordered sequence of matches as a pure fold over <see cref="UpdateRatings"/>,
    /// threading each match's outputs into subsequent inputs by opaque player index. The first
    /// match consumes <paramref name="initialRatings"/>; an empty sequence returns the initial
    /// ratings unchanged. Players are identity-agnostic indices into the initial rating list.
    /// </summary>
    /// <param name="initialRatings">The ratings the replay starts from, indexed positionally.</param>
    /// <param name="matches">The chronologically ordered matches to replay.</param>
    /// <returns>A success carrying the final ratings, or a validation error.</returns>
    Result<IReadOnlyList<Rating>> Replay(
        IReadOnlyList<Rating> initialRatings,
        IReadOnlyList<ReplayMatch> matches);

    /// <summary>
    /// Grows σ back toward the configured initial uncertainty after a period of inactivity.
    /// μ is left unchanged. σ is non-decreasing in whole days and capped at the initial
    /// uncertainty; durations within the decay-free period leave σ unchanged. A negative
    /// duration yields an error with the input unchanged.
    /// </summary>
    /// <param name="rating">The rating to decay.</param>
    /// <param name="inactiveDays">The whole-day inactivity duration.</param>
    /// <returns>A success carrying the decayed <see cref="Rating"/>, or a validation error.</returns>
    Result<Rating> DecayInactivity(Rating rating, int inactiveDays);

    /// <summary>
    /// Computes the balancing prediction primitives for two or more rosters: a win probability
    /// per team (using both μ and σ, normalised to sum to 1.0 within the configured tolerance)
    /// plus a single, independently computed draw probability that is excluded from the win-sum.
    /// Fewer than two rosters, or any empty roster, yields an error with no probabilities.
    /// </summary>
    /// <param name="rosters">The rosters to compare (ratings only; no ranks).</param>
    /// <returns>A success carrying the <see cref="MatchPrediction"/>, or a validation error.</returns>
    Result<MatchPrediction> Predict(IReadOnlyList<TeamRoster> rosters);
}
