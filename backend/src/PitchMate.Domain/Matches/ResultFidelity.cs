namespace PitchMate.Domain.Matches;

/// <summary>
/// The level of detail at which a match's outcome is recorded. Both fidelities must yield a
/// valid win/loss/draw outcome so ratings can always update; richer data enables fuller stats.
/// <para>
/// Persistence stores the stable numeric value, so members must not be renumbered or removed
/// once shipped.
/// </para>
/// </summary>
public enum ResultFidelity
{
    /// <summary>Entered after the final whistle: typically just which team won and the final score. No per-goal detail.</summary>
    Basic = 1,

    /// <summary>Captured live during play (goal events, goalkeeper stints, running score); gated by the squad's live-tracking feature flag.</summary>
    Rich = 2
}
