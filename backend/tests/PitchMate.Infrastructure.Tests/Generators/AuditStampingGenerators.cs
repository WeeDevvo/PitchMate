using FsCheck;

namespace PitchMate.Infrastructure.Tests.Generators;

/// <summary>
/// FsCheck (C#) <see cref="Gen{T}"/> factories feeding the audit-stamping property tests
/// (design Properties 5–7). The generators constrain values to what real PostgreSQL accepts and
/// what makes the properties meaningful:
/// <list type="bullet">
///   <item><description>instants are truncated to <em>microsecond</em> precision — the precision of
///   PostgreSQL <c>timestamp with time zone</c> — and carry a UTC (zero) offset, so a stored value
///   round-trips back exactly for equality assertions;</description></item>
///   <item><description>text is drawn from a NUL-free alphabet, since a PostgreSQL <c>text</c> column
///   rejects the <c>\0</c> character that FsCheck's default string generator can otherwise
///   produce;</description></item>
///   <item><description>the update generator guarantees a strictly-later second instant, a distinct
///   second actor, and a distinct modified name, so the second save genuinely changes a persisted
///   property and the "preserves creation provenance" assertions are non-trivial.</description></item>
/// </list>
/// </summary>
public static class AuditStampingGenerators
{
    /// <summary>The Unix epoch as a UTC <see cref="DateTimeOffset"/>; the anchor for generated instants.</summary>
    private static readonly DateTimeOffset Epoch = new(1970, 1, 1, 0, 0, 0, TimeSpan.Zero);

    /// <summary>A NUL-free alphabet safe to store unchanged in a PostgreSQL <c>text</c> column.</summary>
    private static readonly char[] SafeChars =
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -_@.".ToCharArray();

    /// <summary>
    /// A UTC instant truncated to microsecond precision (so it survives a PostgreSQL
    /// <c>timestamptz</c> round trip exactly), spanning roughly 1970–2023.
    /// </summary>
    public static Gen<DateTimeOffset> UtcInstant() =>
        from seconds in Gen.Choose(0, 1_700_000_000)
        from micros in Gen.Choose(0, 999_999)
        select Epoch.AddSeconds(seconds).AddTicks(micros * 10L);

    /// <summary>A non-empty actor identifier safe to store in a PostgreSQL <c>text</c> column.</summary>
    public static Gen<string> ActorId() =>
        from length in Gen.Choose(1, 24)
        from chars in ListOfLength(length, Gen.Elements(SafeChars))
        select new string(chars.ToArray());

    /// <summary>A non-empty display name safe to store in a PostgreSQL <c>text</c> column.</summary>
    public static Gen<string> SafeName() =>
        from length in Gen.Choose(1, 32)
        from chars in ListOfLength(length, Gen.Elements(SafeChars))
        select new string(chars.ToArray());

    /// <summary>An optional safe text value: either <see langword="null"/> or a non-empty safe string.</summary>
    public static Gen<string?> OptionalText() =>
        Gen.OneOf(
            Gen.Constant((string?)null),
            from s in SafeName() select (string?)s);

    /// <summary>A representative non-PII tier value.</summary>
    public static Gen<int> SkillTier() => Gen.Choose(0, 5);

    /// <summary>Input for design Property 5 (first-persist stamping overrides caller values).</summary>
    public static Gen<NewEntityAuditValues> NewEntityAuditValuesGen() =>
        from clockNow in UtcInstant()
        from actor in ActorId()
        from callerCreatedAt in UtcInstant()
        from callerUpdatedAt in UtcInstant()
        from callerCreatedBy in OptionalText()
        from callerUpdatedBy in OptionalText()
        from displayName in SafeName()
        from email in OptionalText()
        from skillTier in SkillTier()
        select new NewEntityAuditValues(
            clockNow,
            actor,
            callerCreatedAt,
            callerUpdatedAt,
            callerCreatedBy,
            callerUpdatedBy,
            displayName,
            email,
            skillTier);

    /// <summary>Input for design Property 6 (update stamping preserves creation provenance).</summary>
    public static Gen<UpdateAuditValues> UpdateAuditValuesGen() =>
        from firstNow in UtcInstant()
        from advanceSeconds in Gen.Choose(0, 1_000_000)
        from advanceMicros in Gen.Choose(1, 999_999)
        from firstActor in ActorId()
        from secondActorRaw in ActorId()
        from initialName in SafeName()
        from modifiedNameRaw in SafeName()
        from skillTier in SkillTier()
        select BuildUpdate(
            firstNow,
            advanceSeconds,
            advanceMicros,
            firstActor,
            secondActorRaw,
            initialName,
            modifiedNameRaw,
            skillTier);

    /// <summary>Input for design Property 7 (absent actor is tolerated).</summary>
    public static Gen<AbsentActorAuditValues> AbsentActorAuditValuesGen() =>
        from clockNow in UtcInstant()
        from callerCreatedBy in OptionalText()
        from callerUpdatedBy in OptionalText()
        from displayName in SafeName()
        from skillTier in SkillTier()
        select new AbsentActorAuditValues(
            clockNow,
            callerCreatedBy,
            callerUpdatedBy,
            displayName,
            skillTier);

    /// <summary>
    /// Assembles a <see cref="UpdateAuditValues"/>, deriving a strictly-later second instant
    /// (the advance is at least one microsecond) and forcing the second actor and modified name to
    /// differ from their first-persist counterparts.
    /// </summary>
    private static UpdateAuditValues BuildUpdate(
        DateTimeOffset firstNow,
        int advanceSeconds,
        int advanceMicros,
        string firstActor,
        string secondActorRaw,
        string initialName,
        string modifiedNameRaw,
        int skillTier)
    {
        var secondNow = firstNow.AddSeconds(advanceSeconds).AddTicks(advanceMicros * 10L);
        var secondActor = secondActorRaw == firstActor ? secondActorRaw + "_2" : secondActorRaw;
        var modifiedName = modifiedNameRaw == initialName ? initialName + "_x" : modifiedNameRaw;

        return new UpdateAuditValues(
            firstNow,
            secondNow,
            firstActor,
            secondActor,
            initialName,
            modifiedName,
            skillTier);
    }

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
