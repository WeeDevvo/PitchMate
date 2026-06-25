using FsCheck;

namespace PitchMate.Infrastructure.Tests.Generators;

/// <summary>
/// FsCheck (C#) <see cref="Gen{T}"/> factories feeding the soft-delete property tests (design
/// Properties 8, 9, 11, 12). Instants reuse <see cref="AuditStampingGenerators.UtcInstant"/> so they
/// are truncated to PostgreSQL <c>timestamptz</c> microsecond precision with a UTC offset and
/// therefore round-trip exactly for the <c>DeletedAt</c> equality assertions; text reuses the
/// NUL-free <see cref="AuditStampingGenerators.SafeName"/>/<see cref="AuditStampingGenerators.OptionalText"/>
/// generators so values store unchanged in a PostgreSQL <c>text</c> column. The idempotence and
/// restore generators derive a strictly-later second/restore instant so the "grace start preserved"
/// and "restore round trip" assertions are non-trivial.
/// </summary>
public static class SoftDeleteGenerators
{
    /// <summary>Input for design Property 8 (soft-delete transition stamps DeletedAt and retains the row).</summary>
    public static Gen<SoftDeleteTransitionInput> TransitionGen() =>
        from createNow in AuditStampingGenerators.UtcInstant()
        from deleteNow in AuditStampingGenerators.UtcInstant()
        from actor in AuditStampingGenerators.ActorId()
        from displayName in AuditStampingGenerators.SafeName()
        from email in AuditStampingGenerators.OptionalText()
        from skillTier in AuditStampingGenerators.SkillTier()
        select new SoftDeleteTransitionInput(createNow, deleteNow, actor, displayName, email, skillTier);

    /// <summary>Input for design Property 9 (default vs include-deleted query visibility).</summary>
    public static Gen<SoftDeleteVisibilityInput> VisibilityGen() =>
        from createNow in AuditStampingGenerators.UtcInstant()
        from deleteNow in AuditStampingGenerators.UtcInstant()
        from count in Gen.Choose(1, 6)
        from items in ListOfLength(count, VisibilityItemGen())
        select new SoftDeleteVisibilityInput(createNow, deleteNow, items);

    /// <summary>Input for design Property 11 (re-deleting an already-deleted entity preserves the grace start).</summary>
    public static Gen<SoftDeleteIdempotenceInput> IdempotenceGen() =>
        from createNow in AuditStampingGenerators.UtcInstant()
        from firstDeleteNow in AuditStampingGenerators.UtcInstant()
        from advanceSeconds in Gen.Choose(0, 1_000_000)
        from advanceMicros in Gen.Choose(1, 999_999)
        from actor in AuditStampingGenerators.ActorId()
        from displayName in AuditStampingGenerators.SafeName()
        from skillTier in AuditStampingGenerators.SkillTier()
        select new SoftDeleteIdempotenceInput(
            createNow,
            firstDeleteNow,
            firstDeleteNow.AddSeconds(advanceSeconds).AddTicks(advanceMicros * 10L),
            actor,
            displayName,
            skillTier);

    /// <summary>Input for design Property 12 (restore round trip clears IsDeleted/DeletedAt).</summary>
    public static Gen<RestoreRoundTripInput> RestoreGen() =>
        from createNow in AuditStampingGenerators.UtcInstant()
        from deleteNow in AuditStampingGenerators.UtcInstant()
        from advanceSeconds in Gen.Choose(0, 1_000_000)
        from advanceMicros in Gen.Choose(1, 999_999)
        from actor in AuditStampingGenerators.ActorId()
        from displayName in AuditStampingGenerators.SafeName()
        from skillTier in AuditStampingGenerators.SkillTier()
        select new RestoreRoundTripInput(
            createNow,
            deleteNow,
            deleteNow.AddSeconds(advanceSeconds).AddTicks(advanceMicros * 10L),
            actor,
            displayName,
            skillTier);

    /// <summary>A single visibility-set item: a safe display name plus a delete flag.</summary>
    private static Gen<SoftDeleteVisibilityItem> VisibilityItemGen() =>
        from displayName in AuditStampingGenerators.SafeName()
        from delete in Gen.Elements(true, false)
        select new SoftDeleteVisibilityItem(displayName, delete);

    /// <summary>Builds a generator for a read-only list of exactly <paramref name="length"/> items.</summary>
    private static Gen<IReadOnlyList<T>> ListOfLength<T>(int length, Gen<T> element)
    {
        if (length <= 0)
        {
            return Gen.Constant((IReadOnlyList<T>)new List<T>());
        }

        return from head in element
               from tail in ListOfLength(length - 1, element)
               select Prepend(head, tail);
    }

    private static IReadOnlyList<T> Prepend<T>(T head, IReadOnlyList<T> tail)
    {
        var result = new List<T>(tail.Count + 1) { head };
        result.AddRange(tail);
        return result;
    }
}
