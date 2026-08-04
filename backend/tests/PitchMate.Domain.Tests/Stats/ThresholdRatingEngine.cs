using PitchMate.Domain.Rating;

// Alias the rating value type: within a Stats-suffixed namespace the unqualified name `Rating`
// otherwise binds to the PitchMate.Domain.Rating namespace rather than the Rating record.
using PlayerRating = PitchMate.Domain.Rating.Rating;

namespace PitchMate.Domain.Tests.Stats;

/// <summary>
/// A minimal <see cref="IRatingEngine"/> test double that implements only <see cref="GetState"/> — the
/// single engine operation the stats read-shaping types use (Requirement 7.2) — classifying a rating
/// as <see cref="RatingState.Provisional"/> when its σ is strictly above a fixed threshold and
/// <see cref="RatingState.Established"/> otherwise. Every other operation is unsupported, guaranteeing
/// the stats types never reach for rating logic beyond <see cref="GetState"/>.
/// </summary>
internal sealed class ThresholdRatingEngine(double provisionalThreshold) : IRatingEngine
{
    private readonly double _provisionalThreshold = provisionalThreshold;

    /// <inheritdoc />
    public Result<RatingState> GetState(PlayerRating rating) =>
        Result<RatingState>.Ok(
            rating.Sigma > _provisionalThreshold ? RatingState.Provisional : RatingState.Established);

    /// <inheritdoc />
    public Result<PlayerRating> CreateRating(SkillTier? tier = null) =>
        throw new NotSupportedException("The stats read path uses only GetState.");

    /// <inheritdoc />
    public Result<MatchUpdate> UpdateRatings(MatchOutcome outcome) =>
        throw new NotSupportedException("The stats read path uses only GetState.");

    /// <inheritdoc />
    public Result<IReadOnlyList<PlayerRating>> Replay(
        IReadOnlyList<PlayerRating> initialRatings,
        IReadOnlyList<ReplayMatch> matches) =>
        throw new NotSupportedException("The stats read path uses only GetState.");

    /// <inheritdoc />
    public Result<PlayerRating> DecayInactivity(PlayerRating rating, int inactiveDays) =>
        throw new NotSupportedException("The stats read path uses only GetState.");

    /// <inheritdoc />
    public Result<MatchPrediction> Predict(IReadOnlyList<TeamRoster> rosters) =>
        throw new NotSupportedException("The stats read path uses only GetState.");
}
