namespace PitchMate.Domain.Rating;

/// <summary>
/// Classification of a rating's confidence, driven by its σ relative to the provisional threshold.
/// </summary>
public enum RatingState
{
    /// <summary>σ is above the provisional threshold; the rating is not yet settled.</summary>
    Provisional,

    /// <summary>σ is at or below the provisional threshold (including σ = 0); the rating has settled.</summary>
    Established
}
