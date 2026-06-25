using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Domain.Common;

namespace PitchMate.Domain.Tests.Common;

/// <summary>
/// Property-based test for the soft-delete state invariant (persistence-foundation design
/// Property 10). It drives arbitrary interleavings of delete and restore operations through the
/// <c>internal</c> <see cref="BaseEntity.MarkDeleted(System.DateTimeOffset)"/> and
/// <see cref="BaseEntity.Restore"/> mediators on a single entity, asserting after every step that
/// <see cref="BaseEntity.DeletedAt"/> holds a value if and only if <see cref="BaseEntity.IsDeleted"/>
/// is true.
/// <para>
/// Both mediators are unconditional at the Domain level (<c>MarkDeleted</c> always sets
/// <c>IsDeleted=true</c>/<c>DeletedAt=when</c>; <c>Restore</c> always sets <c>false</c>/<c>null</c>),
/// so the invariant must hold after any sequence regardless of the prior state.
/// </para>
/// </summary>
[Trait("Feature", "persistence-foundation")]
public class SoftDeleteInvariantPropertyTests
{
    /// <summary>A fixed UTC epoch the generated deletion instants hang off, keeping them deterministic.</summary>
    private static readonly DateTimeOffset Epoch = new(2024, 1, 1, 0, 0, 0, TimeSpan.Zero);

    /// <summary>A single soft-delete operation: either a delete (at a generated instant) or a restore.</summary>
    private sealed record Operation(bool IsDelete, DateTimeOffset When);

    // Feature: persistence-foundation, Property 10: DeletedAt/IsDeleted invariant - for any sequence
    // of delete and restore operations applied to a soft-deletable entity, DeletedAt holds a value
    // if and only if IsDeleted is true. Validates: Requirements 3.6
    [Property(MaxTest = 100)]
    [Trait("Property", "10")]
    public Property DeletedAtHoldsValueIffIsDeleted() =>
        Prop.ForAll(Arb.From(OperationsGen()), operations =>
        {
            var entity = new SoftDeleteTestEntity();

            // A freshly constructed entity is not deleted and so must carry no DeletedAt.
            if (!InvariantHolds(entity))
            {
                return false;
            }

            foreach (var operation in operations)
            {
                if (operation.IsDelete)
                {
                    entity.MarkDeleted(operation.When);
                }
                else
                {
                    entity.Restore();
                }

                // The invariant must hold after every single step, not just at the end.
                if (!InvariantHolds(entity))
                {
                    return false;
                }
            }

            return InvariantHolds(entity);
        });

    /// <summary>(IsDeleted == true &amp;&amp; DeletedAt != null) || (IsDeleted == false &amp;&amp; DeletedAt == null).</summary>
    private static bool InvariantHolds(BaseEntity entity) =>
        (entity.IsDeleted && entity.DeletedAt is not null)
        || (!entity.IsDeleted && entity.DeletedAt is null);

    /// <summary>
    /// Generates a list of delete/restore operations. Each operation is a delete (~50%) carrying a
    /// generated UTC instant, or a restore. Sequences include the empty sequence and routinely
    /// interleave consecutive deletes and restores to exercise every transition.
    /// </summary>
    private static Gen<List<Operation>> OperationsGen()
    {
        var operationGen =
            from isDelete in Gen.Elements(true, false)
            from offsetSeconds in Gen.Choose(0, 1_000_000)
            select new Operation(isDelete, Epoch.AddSeconds(offsetSeconds));

        return
            from count in Gen.Choose(0, 20)
            from operations in Gen.ListOf(operationGen, count)
            select operations.ToList();
    }
}
