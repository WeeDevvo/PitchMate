using System.Collections.Immutable;

namespace PitchMate.Domain.LiveTracking;

/// <summary>
/// The result of processing a submitted <c>Event_Batch</c> (Requirement 2.1): the ordered per-event
/// <see cref="RecordOutcome"/>s, one for each submitted <c>Match_Event</c> and in the order they were
/// submitted, so a client can correlate every event it sent with how it was classified.
/// <para>
/// The value object is immutable and defensively copies the supplied outcomes. It is a pure result
/// shape carrying no behaviour beyond exposing its outcomes.
/// </para>
/// </summary>
public sealed class BatchResult
{
    private readonly ImmutableArray<RecordOutcome> _outcomes;

    private BatchResult(ImmutableArray<RecordOutcome> outcomes) => _outcomes = outcomes;

    /// <summary>The per-event outcomes, in the order the events were submitted in the batch.</summary>
    public IReadOnlyList<RecordOutcome> Outcomes => _outcomes;

    /// <summary>
    /// Creates a batch result from <paramref name="outcomes"/>, preserving their order and defensively
    /// copying them so the result is immutable.
    /// </summary>
    /// <param name="outcomes">The per-event outcomes in submission order.</param>
    /// <returns>An immutable batch result over the supplied outcomes.</returns>
    public static BatchResult Create(IEnumerable<RecordOutcome> outcomes)
    {
        ArgumentNullException.ThrowIfNull(outcomes);
        return new BatchResult(outcomes.ToImmutableArray());
    }
}
