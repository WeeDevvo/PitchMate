using FsCheck;

namespace PitchMate.Infrastructure.Tests.Generators;

/// <summary>
/// FsCheck <see cref="Arbitrary{T}"/> registrations for the audit-stamping property inputs,
/// backed by the generators in <see cref="AuditStampingGenerators"/>. Reference this class from a
/// property test to feed it valid inputs, e.g.:
/// <code>[Property(Arbitrary = new[] { typeof(AuditStampingArbitraries) })]</code>
/// </summary>
public static class AuditStampingArbitraries
{
    /// <summary>Inputs for the first-persist audit-stamping property (design Property 5).</summary>
    public static Arbitrary<NewEntityAuditValues> NewEntityAuditValues() =>
        Arb.From(AuditStampingGenerators.NewEntityAuditValuesGen());

    /// <summary>Inputs for the update audit-stamping property (design Property 6).</summary>
    public static Arbitrary<UpdateAuditValues> UpdateAuditValues() =>
        Arb.From(AuditStampingGenerators.UpdateAuditValuesGen());

    /// <summary>Inputs for the absent-actor property (design Property 7).</summary>
    public static Arbitrary<AbsentActorAuditValues> AbsentActorAuditValues() =>
        Arb.From(AuditStampingGenerators.AbsentActorAuditValuesGen());
}
