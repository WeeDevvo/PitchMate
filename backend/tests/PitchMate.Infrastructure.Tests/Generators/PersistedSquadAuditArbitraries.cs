using FsCheck;

namespace PitchMate.Infrastructure.Tests.Generators;

/// <summary>
/// FsCheck <see cref="Arbitrary{T}"/> registration for the squad GUID v7 + audit-fields persistence
/// property (design Property 41). Reuses the PostgreSQL-safe instant, actor, and name generators in
/// <see cref="AuditStampingGenerators"/> so the clock instant round-trips through <c>timestamptz</c>
/// exactly and the text values store unchanged. Reference from a property test with:
/// <code>[Property(Arbitrary = new[] { typeof(PersistedSquadAuditArbitraries) })]</code>
/// </summary>
public static class PersistedSquadAuditArbitraries
{
    /// <summary>Inputs for the GUID v7 + audit-fields persistence property (design Property 41).</summary>
    public static Arbitrary<PersistedSquadAuditInput> PersistedSquadAuditInput() =>
        Arb.From(PersistedSquadAuditInputGen());

    private static Gen<PersistedSquadAuditInput> PersistedSquadAuditInputGen() =>
        from clockNow in AuditStampingGenerators.UtcInstant()
        from actor in AuditStampingGenerators.ActorId()
        from squadName in AuditStampingGenerators.SafeName()
        from ownerName in AuditStampingGenerators.SafeName()
        from guestName in AuditStampingGenerators.SafeName()
        select new PersistedSquadAuditInput(
            clockNow,
            actor,
            squadName,
            ownerName,
            guestName,
            Guid.NewGuid());
}
