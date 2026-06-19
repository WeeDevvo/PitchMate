namespace PitchMate.Domain.Rating;

/// <summary>
/// Stable, switchable enumeration of every failure the rating engine can report.
/// The accompanying <see cref="RatingError.Message"/> is for diagnostics only and is never parsed.
/// </summary>
public enum RatingErrorCode
{
    /// <summary>The injected configuration violates a validation rule; all operations are disabled.</summary>
    InvalidConfiguration,

    /// <summary>A match or prediction was supplied with fewer than two teams/rosters.</summary>
    TooFewTeams,

    /// <summary>A team or roster contained no players.</summary>
    EmptyTeam,

    /// <summary>An input rating had a non-positive σ.</summary>
    NonPositiveSigma,

    /// <summary>An input value (μ or σ) was not finite.</summary>
    NonFiniteValue,

    /// <summary>A team outcome rank was negative.</summary>
    NegativeRank,

    /// <summary>A skill tier was supplied that the engine does not recognise.</summary>
    UnknownSkillTier,

    /// <summary>A goal margin was negative while the margin-of-victory lever was enabled.</summary>
    NegativeMargin,

    /// <summary>A goal margin was non-finite while the margin-of-victory lever was enabled.</summary>
    NonFiniteMargin,

    /// <summary>A participation value was missing, non-finite, or out of range while the participation lever was enabled.</summary>
    InvalidParticipation,

    /// <summary>An inactivity duration in days was negative.</summary>
    NegativeDuration,

    /// <summary>A prediction roster input was structurally invalid.</summary>
    InvalidRosterInput,

    /// <summary>A replay match referenced a player index outside the initial ratings list.</summary>
    InvalidPlayerIndex
}
