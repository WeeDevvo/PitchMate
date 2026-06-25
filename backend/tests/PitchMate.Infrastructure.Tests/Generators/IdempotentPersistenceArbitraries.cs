using FsCheck;

namespace PitchMate.Infrastructure.Tests.Generators;

/// <summary>
/// FsCheck <see cref="Arbitrary{T}"/> registrations for the idempotent-persistence and concurrency
/// property inputs, backed by the generators in <see cref="IdempotentPersistenceGenerators"/>.
/// Reference this class from a property test to feed it valid inputs, e.g.:
/// <code>[Property(Arbitrary = new[] { typeof(IdempotentPersistenceArbitraries) })]</code>
/// </summary>
public static class IdempotentPersistenceArbitraries
{
    /// <summary>Inputs for the persistence round-trip property (design Property 20).</summary>
    public static Arbitrary<RoundTripInput> RoundTripInput() =>
        Arb.From(IdempotentPersistenceGenerators.RoundTripGen());

    /// <summary>Inputs for the duplicate-key dedupe property (design Property 21).</summary>
    public static Arbitrary<DuplicateKeyInput> DuplicateKeyInput() =>
        Arb.From(IdempotentPersistenceGenerators.DuplicateKeyGen());

    /// <summary>Inputs for the invalid-identity rejection property (design Property 22).</summary>
    public static Arbitrary<InvalidIdInput> InvalidIdInput() =>
        Arb.From(IdempotentPersistenceGenerators.InvalidIdGen());

    /// <summary>Inputs for the concurrency-conflict property (design Property 23).</summary>
    public static Arbitrary<ConcurrencyConflictInput> ConcurrencyConflictInput() =>
        Arb.From(IdempotentPersistenceGenerators.ConcurrencyGen());
}
