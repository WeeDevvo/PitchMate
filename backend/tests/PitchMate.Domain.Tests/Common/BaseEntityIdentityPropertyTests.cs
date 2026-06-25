using System.Reflection;
using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Domain.Common;

namespace PitchMate.Domain.Tests.Common;

/// <summary>
/// Property-based tests for <see cref="BaseEntity"/> identity assignment, equality, and
/// hashing (persistence-foundation design Properties 1-4). Each property runs at least 100
/// iterations over generators that span <see cref="Guid.Empty"/>, UUID version 7 values, and
/// arbitrary GUIDs.
/// </summary>
[Trait("Feature", "persistence-foundation")]
public class BaseEntityIdentityPropertyTests
{
    private static readonly PropertyInfo IdProperty = typeof(BaseEntity).GetProperty(nameof(BaseEntity.Id))!;

    // Feature: persistence-foundation, Property 1: GUID v7 auto-assignment
    // For any construction with no id supplied or with Guid.Empty, the resulting Id is
    // non-zero and is a UUID version 7. Validates: Requirements 1.2
    [Property(MaxTest = 100)]
    [Trait("Property", "1")]
    public Property GuidV7IsAutoAssignedWhenIdAbsentOrEmpty()
    {
        // true => parameterless constructor (id absent); false => explicit Guid.Empty.
        var gen = Gen.Elements(true, false);

        return Prop.ForAll(Arb.From(gen), useParameterlessConstructor =>
        {
            var entity = useParameterlessConstructor
                ? new IdentityTestEntity()
                : new IdentityTestEntity(Guid.Empty);

            return entity.Id != Guid.Empty && entity.Id.Version == 7;
        });
    }

    // Feature: persistence-foundation, Property 2: Caller-supplied identity is retained
    // For any non-zero GUID supplied at construction, the entity's Id equals it unchanged.
    // Validates: Requirements 1.3
    [Property(MaxTest = 100)]
    [Trait("Property", "2")]
    public Property CallerSuppliedIdentityIsRetained() =>
        Prop.ForAll(Arb.From(IdentityGenerators.NonEmptyGuid()), id =>
        {
            var entity = new IdentityTestEntity(id);
            return entity.Id == id;
        });

    // Feature: persistence-foundation, Property 3: Identity equality semantics
    // Two entities are equal iff same reference, OR same runtime type AND same non-empty Id;
    // never equal to null; two all-zero-Id instances are unequal unless same reference; two
    // different runtime subtypes with the same Id are not equal. Validates: Requirements 1.6, 1.7
    [Property(MaxTest = 100)]
    [Trait("Property", "3")]
    public Property IdentityEqualitySemantics()
    {
        var gen =
            from idA in IdentityGenerators.AnyGuid()
            from idBRaw in IdentityGenerators.AnyGuid()
            from sameType in Gen.Elements(true, false)
            from shareId in Gen.Elements(true, false)
            select (idA, idBRaw, sameType, shareId);

        return Prop.ForAll(Arb.From(gen), input =>
        {
            var (idA, idBRaw, sameType, shareId) = input;
            var idB = shareId ? idA : idBRaw;

            var a = CreateIdentity(idA);
            BaseEntity b = sameType ? CreateIdentity(idB) : CreateOther(idB);

            return EqualitySemanticsHold(a, b);
        });
    }

    // Verifies the full identity-equality oracle for two distinct (non-reference-equal) entities.
    private static bool EqualitySemanticsHold(BaseEntity a, BaseEntity b)
    {
        // Two entities are equal iff same runtime type and same non-empty Id (they are never
        // the same reference here).
        var expectedEqual =
            a.GetType() == b.GetType()
            && a.Id != Guid.Empty
            && b.Id != Guid.Empty
            && a.Id == b.Id;

        // Reflexivity: an entity equals itself (the "same object reference" clause).
        object sameReference = a;
        var reflexive = a.Equals(sameReference);
        var equalsMatchesOracle = a.Equals(b) == expectedEqual;

        // Performed last: comparing against null narrows the analyzer's null-state for the
        // receiver, so keep any further dereferences of `a` above this line.
        var neverEqualToNull = !a.Equals(null);

        return equalsMatchesOracle && neverEqualToNull && reflexive;
    }

    // Feature: persistence-foundation, Property 4: Hash consistency with equality
    // The hash of an entity with a non-zero Id derives solely from that Id. Validates: Requirements 1.8
    [Property(MaxTest = 100)]
    [Trait("Property", "4")]
    public Property HashDerivesSolelyFromIdForNonEmptyId() =>
        Prop.ForAll(Arb.From(IdentityGenerators.NonEmptyGuid()), id =>
        {
            var entity = new IdentityTestEntity(id);
            return entity.GetHashCode() == id.GetHashCode();
        });

    // Feature: persistence-foundation, Property 4: Hash consistency with equality
    // Instances deemed equal under Property 3 yield equal hash codes. Validates: Requirements 1.8
    [Property(MaxTest = 100)]
    [Trait("Property", "4")]
    public Property EqualInstancesYieldEqualHashCodes() =>
        Prop.ForAll(Arb.From(IdentityGenerators.NonEmptyGuid()), id =>
        {
            var a = new IdentityTestEntity(id);
            var b = new IdentityTestEntity(id);

            // Same runtime type and same non-empty Id => equal under Property 3.
            return a.Equals(b) && a.GetHashCode() == b.GetHashCode();
        });

    private static IdentityTestEntity CreateIdentity(Guid id)
    {
        var entity = id == Guid.Empty ? new IdentityTestEntity() : new IdentityTestEntity(id);
        if (id == Guid.Empty)
        {
            // The constructor replaces an empty id with a v7 value; force the all-zero id back
            // so the equality guard for transient (unpersisted) entities can be exercised.
            IdProperty.SetValue(entity, Guid.Empty);
        }

        return entity;
    }

    private static OtherIdentityTestEntity CreateOther(Guid id)
    {
        var entity = id == Guid.Empty ? new OtherIdentityTestEntity() : new OtherIdentityTestEntity(id);
        if (id == Guid.Empty)
        {
            IdProperty.SetValue(entity, Guid.Empty);
        }

        return entity;
    }
}
