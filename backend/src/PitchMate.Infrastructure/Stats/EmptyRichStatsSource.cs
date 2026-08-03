using PitchMate.Application.Stats;

namespace PitchMate.Infrastructure.Stats;

/// <summary>
/// MVP implementation of <see cref="IRichStatsSource"/> for use until the live-tracking spec
/// introduces the goal-event and goalkeeper-stint tables this source would query. It reports
/// <see langword="null"/> ("no data") for every membership and a <see langword="null"/> top scorer
/// for every squad (Requirement 13.2, 13.3, 13.4).
///
/// <para>
/// <b>Why "no data" is the correct current behaviour.</b> This spec deliberately does not define or
/// capture rich-tracking data (Requirement 13.5); the goal-event and goalkeeper-stint tables do not
/// yet exist, so there is genuinely no rich detail to report. Returning <see langword="null"/> — as
/// opposed to a zero value — lets the profile handler degrade gracefully: an enabled squad surfaces
/// rich statistics as "no data" while a disabled squad omits them entirely (Requirement 13.8). Once
/// the live-tracking spec exists, it replaces this registration with an implementation that computes
/// rich statistics from the recorded detail (Requirement 13.3, 13.4).
/// </para>
/// </summary>
public sealed class EmptyRichStatsSource : IRichStatsSource
{
    /// <inheritdoc />
    public Task<RichStats?> GetForMembershipAsync(Guid squadId, Guid membershipId, CancellationToken ct)
        => Task.FromResult<RichStats?>(null);

    /// <inheritdoc />
    public Task<Guid?> GetTopScorerAsync(Guid squadId, CancellationToken ct)
        => Task.FromResult<Guid?>(null);
}
