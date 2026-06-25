using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Domain.Common;

namespace PitchMate.Domain.Tests.Common;

/// <summary>
/// Property-based tests for <see cref="ChronologicalOrder"/> (persistence-foundation design
/// Property 24, in-memory portion). They establish that ordering by
/// <see cref="BaseEntity.CreatedAt"/> ascending then <see cref="BaseEntity.Id"/> ascending (via
/// <see cref="UuidV7Comparer"/>) is a deterministic strict total order: the same set of records
/// always sorts to the identical sequence regardless of input order, and creation-time ties are
/// broken by the GUID version 7 byte order.
/// <para>
/// Each generated record carries a unique UUID version 7 <see cref="BaseEntity.Id"/> and a
/// <see cref="BaseEntity.CreatedAt"/> drawn from a small bucket of distinct instants, so multiple
/// records routinely share a creation instant and exercise the tie-break path.
/// </para>
/// </summary>
[Trait("Feature", "persistence-foundation")]
public class ChronologicalOrderPropertyTests
{
    /// <summary>A fixed UTC epoch the timestamp buckets hang off, keeping instants deterministic.</summary>
    private static readonly DateTimeOffset Epoch = new(2024, 1, 1, 0, 0, 0, TimeSpan.Zero);

    // Feature: persistence-foundation, Property 24 (in-memory): sorting with ChronologicalOrder
    // yields a strictly increasing sequence (every adjacent pair compares < 0). Because every Id is
    // unique no two distinct records ever compare equal. Validates: Requirements 10.1, 10.2, 10.3, 10.4
    [Property(MaxTest = 100)]
    [Trait("Property", "24")]
    public Property SortedSequenceIsStrictlyIncreasing() =>
        Prop.ForAll(Arb.From(ScenarioGen()), scenario =>
        {
            var sorted = Sort(scenario.Records);

            for (var i = 0; i < sorted.Count - 1; i++)
            {
                if (ChronologicalOrder.Instance.Compare(sorted[i], sorted[i + 1]) >= 0)
                {
                    return false;
                }
            }

            return true;
        });

    // Feature: persistence-foundation, Property 24 (in-memory): the comparer is a strict total
    // order - antisymmetric (Compare(a,b) and Compare(b,a) have opposite signs, and a record
    // compares equal only to itself) and transitive across the whole set.
    // Validates: Requirements 10.1, 10.2, 10.3, 10.4
    [Property(MaxTest = 100)]
    [Trait("Property", "24")]
    public Property ComparerIsAStrictTotalOrder() =>
        Prop.ForAll(Arb.From(ScenarioGen()), scenario =>
        {
            var records = scenario.Records;

            // Antisymmetry / consistency: opposite signs for distinct records (Ids are unique, so
            // distinct records never tie), and a record compares equal to itself.
            foreach (var a in records)
            {
                if (ChronologicalOrder.Instance.Compare(a, a) != 0)
                {
                    return false;
                }

                foreach (var b in records)
                {
                    var ab = Math.Sign(ChronologicalOrder.Instance.Compare(a, b));
                    var ba = Math.Sign(ChronologicalOrder.Instance.Compare(b, a));

                    if (ReferenceEquals(a, b))
                    {
                        continue;
                    }

                    if (ab != -ba || ab == 0)
                    {
                        return false;
                    }
                }
            }

            // Transitivity: if a <= b and b <= c then a <= c, over every triple in the set.
            foreach (var a in records)
            {
                foreach (var b in records)
                {
                    foreach (var c in records)
                    {
                        var ab = ChronologicalOrder.Instance.Compare(a, b);
                        var bc = ChronologicalOrder.Instance.Compare(b, c);
                        var ac = ChronologicalOrder.Instance.Compare(a, c);

                        if (ab <= 0 && bc <= 0 && ac > 0)
                        {
                            return false;
                        }
                    }
                }
            }

            return true;
        });

    // Feature: persistence-foundation, Property 24 (in-memory): determinism / order-independence -
    // sorting the same set of records produces the identical sequence (by Id) no matter how the
    // input is shuffled. Validates: Requirements 10.1, 10.2, 10.3, 10.4
    [Property(MaxTest = 100)]
    [Trait("Property", "24")]
    public Property SortIsOrderIndependent() =>
        Prop.ForAll(Arb.From(ScenarioGen()), scenario =>
        {
            var canonical = Sort(scenario.Records).Select(r => r.Id).ToList();

            foreach (var shuffle in scenario.Shuffles)
            {
                var sortedShuffle = Sort(shuffle).Select(r => r.Id).ToList();
                if (!canonical.SequenceEqual(sortedShuffle))
                {
                    return false;
                }
            }

            return true;
        });

    // Feature: persistence-foundation, Property 24 (in-memory): tie-breaking by Id (Req 10.2) -
    // when two records share a CreatedAt the comparison sign matches UuidV7Comparer on their Ids;
    // when CreatedAt differs the comparison sign matches the creation-instant ordering.
    // Validates: Requirements 10.1, 10.2, 10.3, 10.4
    [Property(MaxTest = 100)]
    [Trait("Property", "24")]
    public Property TiesAreBrokenByUuidV7Order() =>
        Prop.ForAll(Arb.From(ScenarioGen()), scenario =>
        {
            var records = scenario.Records;

            foreach (var a in records)
            {
                foreach (var b in records)
                {
                    var actual = Math.Sign(ChronologicalOrder.Instance.Compare(a, b));
                    var byTime = a.CreatedAt.UtcDateTime.CompareTo(b.CreatedAt.UtcDateTime);

                    var expected = byTime != 0
                        ? Math.Sign(byTime)
                        : Math.Sign(UuidV7Comparer.Compare(a.Id, b.Id));

                    if (actual != expected)
                    {
                        return false;
                    }
                }
            }

            return true;
        });

    /// <summary>Orders a record sequence with the shared <see cref="ChronologicalOrder"/> comparer.</summary>
    private static List<OrderingTestEntity> Sort(IEnumerable<OrderingTestEntity> records) =>
        records.OrderBy(r => (BaseEntity)r, ChronologicalOrder.Instance).ToList();

    /// <summary>
    /// Generates a record set plus several shuffles of it. Records are bucketed across a small set
    /// of distinct creation instants so creation-time ties occur frequently, and every record gets
    /// a unique UUID version 7 identity.
    /// </summary>
    private static Gen<OrderingScenario> ScenarioGen()
    {
        var recordsGen =
            from bucketCount in Gen.Choose(1, 5)
            from count in Gen.Choose(0, 12)
            from buckets in Gen.ListOf(Gen.Choose(0, bucketCount - 1), count)
            select buckets.Select(CreateRecord).ToList();

        return
            from records in recordsGen
            from s1 in Gen.Shuffle<OrderingTestEntity>(records)
            from s2 in Gen.Shuffle<OrderingTestEntity>(records)
            from s3 in Gen.Shuffle<OrderingTestEntity>(records)
            select new OrderingScenario(
                records,
                new[] { records.ToArray(), s1, s2, s3 });
    }

    /// <summary>Creates a record whose CreatedAt is the bucket's distinct instant and whose Id is a fresh v7 GUID.</summary>
    private static OrderingTestEntity CreateRecord(int bucket) =>
        new(Guid.CreateVersion7()) { CreatedAt = Epoch.AddSeconds(bucket) };

    /// <summary>A generated set of records together with shuffled orderings of the same records.</summary>
    private sealed record OrderingScenario(
        IReadOnlyList<OrderingTestEntity> Records,
        IReadOnlyList<OrderingTestEntity[]> Shuffles);
}
