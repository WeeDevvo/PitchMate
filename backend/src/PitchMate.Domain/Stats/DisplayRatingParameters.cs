namespace PitchMate.Domain.Stats;

/// <summary>
/// The per-<c>Squad</c> scale <see cref="K"/>, offset <see cref="C"/>, and <see cref="Floor"/> applied
/// to map a conservative rating estimate (μ − 3σ) to a friendly <c>Display_Rating</c>. Each value
/// defaults — via <see cref="Create"/> — to <see cref="DefaultK"/>, <see cref="DefaultC"/>, or
/// <see cref="DefaultFloor"/> respectively for any value a squad has left unconfigured
/// (Requirement 7.5).
/// </summary>
/// <param name="K">The scale applied to the conservative estimate.</param>
/// <param name="C">The offset added after scaling.</param>
/// <param name="Floor">The inclusive lower bound the computed display rating is never below.</param>
public readonly record struct DisplayRatingParameters(double K, double C, double Floor)
{
    /// <summary>The default scale applied when a squad has left <see cref="K"/> unconfigured.</summary>
    public const double DefaultK = 40.0;

    /// <summary>The default offset applied when a squad has left <see cref="C"/> unconfigured.</summary>
    public const double DefaultC = 1000.0;

    /// <summary>The default floor applied when a squad has left <see cref="Floor"/> unconfigured.</summary>
    public const double DefaultFloor = 0.0;

    /// <summary>The parameter set using the default scale, offset, and floor.</summary>
    public static DisplayRatingParameters Default { get; } = new(DefaultK, DefaultC, DefaultFloor);

    /// <summary>
    /// Creates a parameter set, substituting the default for each value the squad has left unconfigured
    /// (<see langword="null"/>): <see cref="DefaultK"/> for <paramref name="k"/>, <see cref="DefaultC"/>
    /// for <paramref name="c"/>, and <see cref="DefaultFloor"/> for <paramref name="floor"/>
    /// (Requirement 7.5).
    /// </summary>
    /// <param name="k">The configured scale, or <see langword="null"/> to use the default.</param>
    /// <param name="c">The configured offset, or <see langword="null"/> to use the default.</param>
    /// <param name="floor">The configured floor, or <see langword="null"/> to use the default.</param>
    /// <returns>A parameter set with defaults substituted for unconfigured values.</returns>
    public static DisplayRatingParameters Create(double? k = null, double? c = null, double? floor = null) =>
        new(k ?? DefaultK, c ?? DefaultC, floor ?? DefaultFloor);
}
