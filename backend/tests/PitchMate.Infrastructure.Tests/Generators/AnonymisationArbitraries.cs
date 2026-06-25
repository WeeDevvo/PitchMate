using FsCheck;

namespace PitchMate.Infrastructure.Tests.Generators;

/// <summary>
/// FsCheck <see cref="Arbitrary{T}"/> registrations for the anonymisation-persistence property
/// inputs, backed by the generators in <see cref="AnonymisationGenerators"/>. Reference this class
/// from a property test to feed it valid inputs, e.g.:
/// <code>[Property(Arbitrary = new[] { typeof(AnonymisationArbitraries) })]</code>
/// </summary>
public static class AnonymisationArbitraries
{
    /// <summary>Inputs for the anonymisation audit-metadata property (design Property 14).</summary>
    public static Arbitrary<AnonymisationAuditInput> AnonymisationAuditInput() =>
        Arb.From(AnonymisationGenerators.AuditGen());

    /// <summary>Inputs for the anonymisation soft-delete-preservation property (design Property 15).</summary>
    public static Arbitrary<AnonymisationSoftDeleteInput> AnonymisationSoftDeleteInput() =>
        Arb.From(AnonymisationGenerators.SoftDeleteGen());
}
