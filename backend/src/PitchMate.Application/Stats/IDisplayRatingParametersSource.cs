using PitchMate.Domain.Stats;

namespace PitchMate.Application.Stats;

/// <summary>
/// Source of the per-squad <see cref="DisplayRatingParameters"/> (scale, offset, floor) used to map a
/// conservative rating estimate (μ − 3σ) to a friendly display rating. Declared in Application so the
/// stats use cases stay free of persistence concerns; implemented in Infrastructure. The MVP
/// implementation returns the defaults (K = 40, C = 1000, Floor = 0) for every squad, substituting a
/// default for each unconfigured value, with the contract ready for future per-squad storage
/// (Requirement 7.5).
/// </summary>
public interface IDisplayRatingParametersSource
{
    /// <summary>
    /// Retrieves the display-rating parameters for <paramref name="squadId"/>, with the default
    /// substituted for each value the squad has left unconfigured (Requirement 7.5).
    /// </summary>
    /// <param name="squadId">The squad whose display-rating parameters are read.</param>
    /// <param name="ct">A token that surfaces cancellation to the caller.</param>
    /// <returns>The squad's display-rating parameters.</returns>
    Task<DisplayRatingParameters> GetAsync(Guid squadId, CancellationToken ct);
}
