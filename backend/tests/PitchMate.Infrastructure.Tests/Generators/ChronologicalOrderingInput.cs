namespace PitchMate.Infrastructure.Tests.Generators;

/// <summary>
/// Generated input for the database-evaluated chronological-ordering property (design
/// Property 24). It carries an arbitrary set of rows to persist — with varying (and
/// deliberately repeating) <c>CreatedAt</c> instants and a mix of soft-deleted and live
/// rows — and whether the read should include soft-deleted rows. The items are persisted in
/// their generated (arbitrary) order, which is independent of their chronological order, so
/// the property exercises insertion-order independence.
/// </summary>
/// <param name="Items">The rows to persist, in arbitrary insertion order.</param>
/// <param name="IncludeDeleted">Whether <c>ListChronologicalAsync</c> is asked to include soft-deleted rows.</param>
public sealed record ChronologicalOrderingInput(
    IReadOnlyList<ChronologicalOrderingItem> Items,
    bool IncludeDeleted);
