namespace PitchMate.Domain.Rating;

/// <summary>
/// Optional cold-start skill tier used to seed a new player's initial mean (μ).
/// σ stays high regardless of tier so the rating still converges from real results.
/// </summary>
public enum SkillTier
{
    /// <summary>Below-average starting skill; seeds the lowest configured mean.</summary>
    Beginner,

    /// <summary>Average starting skill; seeds the default configured mean.</summary>
    Average,

    /// <summary>Above-average starting skill; seeds the highest configured mean.</summary>
    Strong
}
