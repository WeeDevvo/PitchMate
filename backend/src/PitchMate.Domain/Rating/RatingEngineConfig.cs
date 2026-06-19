namespace PitchMate.Domain.Rating;

/// <summary>
/// Injected set of model parameters for the rating engine. Every value has a documented
/// default; omitted values fall back to these defaults. The engine validates the config at
/// construction and gates all operations on a valid configuration.
/// </summary>
public sealed record RatingEngineConfig
{
    /// <summary>Default mean (μ) assigned to a new player when no skill tier is supplied.</summary>
    public double DefaultMean { get; init; } = 25.0;

    /// <summary>Initial uncertainty (σ₀) assigned to every new rating, regardless of tier.</summary>
    public double InitialUncertainty { get; init; } = 25.0 / 3.0;

    /// <summary>PlackettLuce performance variance parameter (β).</summary>
    public double Beta { get; init; } = 25.0 / 6.0;

    /// <summary>Dynamics factor (τ). Not applied inside the match update; reserved for tuning.</summary>
    public double Tau { get; init; } = 25.0 / 300.0;

    /// <summary>σ threshold above which a rating is Provisional and at/below which it is Established.</summary>
    public double ProvisionalThreshold { get; init; } = 25.0 / 6.0;

    /// <summary>Number of inactive days that elapse before uncertainty decay begins (~6 weeks).</summary>
    public int DecayFreePeriodDays { get; init; } = 42;

    /// <summary>Variance growth per inactive day past the decay-free period.</summary>
    public double DecayRate { get; init; } = 0.05;

    /// <summary>Margin-of-victory weighting lever. Designed in, shipped off by default.</summary>
    public bool MarginOfVictoryWeightingEnabled { get; init; } = false;

    /// <summary>Participation weighting lever. Designed in, shipped off by default.</summary>
    public bool ParticipationWeightingEnabled { get; init; } = false;

    /// <summary>Seeded mean (μ) for the Beginner skill tier.</summary>
    public double BeginnerMean { get; init; } = 20.0;

    /// <summary>Seeded mean (μ) for the Average skill tier.</summary>
    public double AverageMean { get; init; } = 25.0;

    /// <summary>Seeded mean (μ) for the Strong skill tier.</summary>
    public double StrongMean { get; init; } = 30.0;

    /// <summary>Upper bound (inclusive cap) for the margin-of-victory multiplier.</summary>
    public double MarginMultiplierMax { get; init; } = 1.5;

    /// <summary>Tolerance used for all "within tolerance" numeric comparisons.</summary>
    public double NumericTolerance { get; init; } = 1e-9;
}
