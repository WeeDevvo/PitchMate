using FsCheck;

namespace PitchMate.Infrastructure.Tests.Generators;

/// <summary>
/// FsCheck (C#) <see cref="Gen{T}"/> factories feeding the database-evaluated chronological-ordering
/// property test (design Property 24). The generator draws a small pool of distinct
/// microsecond-precision UTC instants (the precision of PostgreSQL <c>timestamptz</c>, so the
/// in-memory and database comparisons agree) and assigns each generated row one of those instants —
/// so multiple rows frequently share a <c>CreatedAt</c> and exercise the <c>Id</c> tie-breaker — plus
/// an independent soft-delete flag. Rows are produced in arbitrary order, independent of their
/// chronological order, so the property covers insertion-order independence.
/// </summary>
public static class ChronologicalOrderingGenerators
{
    /// <summary>Input for design Property 24 (database-evaluated chronological ordering).</summary>
    public static Gen<ChronologicalOrderingInput> ChronologicalOrderingGen() =>
        from includeDeleted in Gen.Elements(true, false)
        // A small pool (1–4) of distinct instants so several rows collide on CreatedAt and the
        // Id tie-breaker is exercised. DistinctInstants keeps each pool entry unique.
        from poolSize in Gen.Choose(1, 4)
        from pool in DistinctInstants(poolSize)
        // 1–7 rows: enough to exercise ordering and ties without making each 100-iteration run slow.
        from count in Gen.Choose(1, 7)
        from items in ListOfLength(count, ItemGen(pool))
        select new ChronologicalOrderingInput(items, includeDeleted);

    /// <summary>Generates a single row: an instant chosen from the shared pool, plus a soft-delete flag.</summary>
    private static Gen<ChronologicalOrderingItem> ItemGen(IReadOnlyList<DateTimeOffset> pool) =>
        from index in Gen.Choose(0, pool.Count - 1)
        from isDeleted in Gen.Elements(true, false)
        select new ChronologicalOrderingItem(pool[index], isDeleted);

    /// <summary>
    /// Generates a list of exactly <paramref name="size"/> distinct UTC instants, so the pool
    /// entries are genuinely different creation instants (ties come from rows sharing a pool entry,
    /// not from duplicate pool entries).
    /// </summary>
    private static Gen<IReadOnlyList<DateTimeOffset>> DistinctInstants(int size) =>
        from candidates in ListOfLength(size * 4, AuditStampingGenerators.UtcInstant())
        select (IReadOnlyList<DateTimeOffset>)candidates.Distinct().Take(size).ToList();

    /// <summary>Builds a generator for a list of exactly <paramref name="length"/> items.</summary>
    private static Gen<List<T>> ListOfLength<T>(int length, Gen<T> element)
    {
        if (length <= 0)
        {
            return Gen.Constant(new List<T>());
        }

        return from head in element
               from tail in ListOfLength(length - 1, element)
               select Prepend(head, tail);
    }

    private static List<T> Prepend<T>(T head, List<T> tail)
    {
        var result = new List<T>(tail.Count + 1) { head };
        result.AddRange(tail);
        return result;
    }
}
