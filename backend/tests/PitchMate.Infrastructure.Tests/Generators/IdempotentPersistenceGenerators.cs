using FsCheck;

namespace PitchMate.Infrastructure.Tests.Generators;

/// <summary>
/// FsCheck (C#) <see cref="Gen{T}"/> factories feeding the idempotent-persistence and concurrency
/// property tests (design Properties 20–23). They reuse the NUL-free text and microsecond-precision
/// UTC instant generators from <see cref="AuditStampingGenerators"/> so values store and round-trip
/// through real PostgreSQL <c>text</c>/<c>timestamptz</c> columns unchanged, and add a
/// <see cref="NonZeroGuidGen">non-zero GUID generator</see> producing deterministic, distinct
/// client-assigned identities. Generators that need genuinely-changed values (the duplicate's
/// display name, the concurrency updates) force distinctness so each property's assertions are
/// non-trivial.
/// </summary>
public static class IdempotentPersistenceGenerators
{
    /// <summary>
    /// A non-zero GUID built from 16 random bytes (with a guaranteed non-zero first byte), giving a
    /// deterministic, distinct client-assigned <c>Entity_Id</c> for the round-trip and duplicate-key
    /// properties without depending on the wall clock.
    /// </summary>
    public static Gen<Guid> NonZeroGuidGen() =>
        from bytes in Bytes(16)
        select ToNonZeroGuid(bytes);

    /// <summary>Input for design Property 20 (round trip preserves identity and UTC instants).</summary>
    public static Gen<RoundTripInput> RoundTripGen() =>
        from id in NonZeroGuidGen()
        from clockNow in AuditStampingGenerators.UtcInstant()
        from displayName in AuditStampingGenerators.SafeName()
        from email in AuditStampingGenerators.OptionalText()
        from skillTier in AuditStampingGenerators.SkillTier()
        select new RoundTripInput(id, clockNow, displayName, email, skillTier);

    /// <summary>Input for design Property 21 (duplicate-key dedupe with a distinct error).</summary>
    public static Gen<DuplicateKeyInput> DuplicateKeyGen() =>
        from id in NonZeroGuidGen()
        from clockNow in AuditStampingGenerators.UtcInstant()
        from firstName in AuditStampingGenerators.SafeName()
        from secondNameRaw in AuditStampingGenerators.SafeName()
        from skillTier in AuditStampingGenerators.SkillTier()
        select new DuplicateKeyInput(
            id,
            clockNow,
            firstName,
            Distinct(secondNameRaw, firstName),
            skillTier);

    /// <summary>Input for design Property 22 (invalid identity is rejected before persistence).</summary>
    public static Gen<InvalidIdInput> InvalidIdGen() =>
        from clockNow in AuditStampingGenerators.UtcInstant()
        from displayName in AuditStampingGenerators.SafeName()
        from skillTier in AuditStampingGenerators.SkillTier()
        select new InvalidIdInput(clockNow, displayName, skillTier);

    /// <summary>Input for design Property 23 (concurrency conflict is surfaced).</summary>
    public static Gen<ConcurrencyConflictInput> ConcurrencyGen() =>
        from clockNow in AuditStampingGenerators.UtcInstant()
        from initialName in AuditStampingGenerators.SafeName()
        from firstUpdateRaw in AuditStampingGenerators.SafeName()
        from secondUpdateRaw in AuditStampingGenerators.SafeName()
        from skillTier in AuditStampingGenerators.SkillTier()
        select new ConcurrencyConflictInput(
            clockNow,
            initialName,
            Distinct(firstUpdateRaw, initialName),
            Distinct(secondUpdateRaw, initialName),
            skillTier);

    /// <summary>Returns <paramref name="candidate"/>, or a perturbed variant when it equals <paramref name="other"/>.</summary>
    private static string Distinct(string candidate, string other) =>
        candidate == other ? candidate + "_x" : candidate;

    /// <summary>Builds a GUID from the supplied 16 bytes, guaranteeing it is not the all-zero GUID.</summary>
    private static Guid ToNonZeroGuid(IReadOnlyList<byte> bytes)
    {
        var buffer = bytes.ToArray();

        // Guarantee a non-zero value so the generated id is a valid client-assigned Entity_Id.
        if (buffer.All(b => b == 0))
        {
            buffer[0] = 1;
        }

        return new Guid(buffer);
    }

    /// <summary>Generates a list of exactly <paramref name="length"/> bytes.</summary>
    private static Gen<IReadOnlyList<byte>> Bytes(int length)
    {
        if (length <= 0)
        {
            return Gen.Constant((IReadOnlyList<byte>)new List<byte>());
        }

        return from head in Gen.Choose(0, 255)
               from tail in Bytes(length - 1)
               select Prepend((byte)head, tail);
    }

    private static IReadOnlyList<byte> Prepend(byte head, IReadOnlyList<byte> tail)
    {
        var result = new List<byte>(tail.Count + 1) { head };
        result.AddRange(tail);
        return result;
    }
}
