using PitchMate.Application.Stats;
using PitchMate.Domain.Stats;

namespace PitchMate.Infrastructure.Stats;

/// <summary>
/// MVP implementation of <see cref="IDisplayRatingParametersSource"/> that returns the default
/// display-rating parameters (K = 40, C = 1000, Floor = 0) for every squad, substituting the default
/// for each value a squad has left unconfigured (Requirement 7.5).
///
/// <para>
/// <b>Why the defaults for every squad.</b> The <c>Squad</c> entity does not yet persist per-squad
/// display-rating parameters, so there is nothing configured to read; every squad therefore uses the
/// defaults. This is modelled through <see cref="DisplayRatingParameters.Create"/>, which substitutes
/// a default per unconfigured value, so introducing per-squad storage later is a small additive change:
/// this source would read the squad's configured values (any of which may still be unset) and pass
/// them through the same factory, and no caller changes.
/// </para>
/// </summary>
public sealed class SquadDisplayRatingParametersSource : IDisplayRatingParametersSource
{
    /// <inheritdoc />
    public Task<DisplayRatingParameters> GetAsync(Guid squadId, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();

        // No per-squad values are persisted yet, so every value is unconfigured (null) and the factory
        // substitutes the MVP defaults K = 40, C = 1000, Floor = 0 (Requirement 7.5). When per-squad
        // storage arrives, read the squad's configured values here and pass them to Create; unset ones
        // still fall back to the defaults.
        return Task.FromResult(DisplayRatingParameters.Create());
    }
}
