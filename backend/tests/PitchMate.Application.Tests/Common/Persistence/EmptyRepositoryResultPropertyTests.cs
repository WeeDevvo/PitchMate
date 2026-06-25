using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Application.Tests.Fakes;

namespace PitchMate.Application.Tests.Common.Persistence;

/// <summary>
/// Property-based tests for the Application-layer <c>IRepository&lt;T&gt;</c> abstraction
/// (persistence-foundation design Property 17). They establish that absent results surface as
/// absence rather than errors: a lookup for an <c>Entity_Id</c> that matches no non-deleted
/// entity returns <see langword="null"/> without raising, and a collection retrieve over a
/// repository with no matching entities returns an empty (never <see langword="null"/>)
/// collection rather than an error.
/// <para>
/// The properties run against the hand-written in-memory <see cref="InMemoryRepository{T}"/>
/// fake — a real test double backed by a dictionary, never a database — at least 100 iterations
/// each. Generators span the all-zero GUID, UUID version 7 values, and arbitrary GUIDs so the
/// "no match" path is exercised across the whole identity space.
/// </para>
/// </summary>
[Trait("Feature", "persistence-foundation")]
public class EmptyRepositoryResultPropertyTests
{
    // Feature: persistence-foundation, Property 17: Empty repository results are absent/empty,
    // never errors. For any Entity_Id queried against an empty repository, GetByIdAsync returns an
    // absent result (null) without raising. Validates: Requirements 5.4
    [Property(MaxTest = 100)]
    [Trait("Property", "17")]
    public Property EmptyRepository_GetById_ReturnsNullWithoutError() =>
        Prop.ForAll(Arb.From(AnyGuid()), id =>
        {
            var repository = new InMemoryRepository<RepositoryTestEntity>();

            var result = repository.GetByIdAsync(id, CancellationToken.None).GetAwaiter().GetResult();

            return result is null;
        });

    // Feature: persistence-foundation, Property 17: Empty repository results are absent/empty,
    // never errors. When no non-deleted entities exist, ListAsync returns an empty collection that
    // is never null and never an error. Validates: Requirements 5.5
    [Property(MaxTest = 100)]
    [Trait("Property", "17")]
    public Property EmptyRepository_List_ReturnsEmptyCollectionNeverNull() =>
        Prop.ForAll(Arb.From(Gen.Constant(0)), _ =>
        {
            var repository = new InMemoryRepository<RepositoryTestEntity>();

            var result = repository.ListAsync(CancellationToken.None).GetAwaiter().GetResult();

            return result is not null && result.Count == 0;
        });

    // Feature: persistence-foundation, Property 17: Empty repository results are absent/empty,
    // never errors. When no entities exist, ListChronologicalAsync returns an empty collection that
    // is never null and never an error, whether or not soft-deleted rows are requested.
    // Validates: Requirements 5.5
    [Property(MaxTest = 100)]
    [Trait("Property", "17")]
    public Property EmptyRepository_ListChronological_ReturnsEmptyCollectionNeverNull() =>
        Prop.ForAll(Arb.From(Gen.Elements(true, false)), includeDeleted =>
        {
            var repository = new InMemoryRepository<RepositoryTestEntity>();

            var result = repository
                .ListChronologicalAsync(includeDeleted, CancellationToken.None)
                .GetAwaiter()
                .GetResult();

            return result is not null && result.Count == 0;
        });

    // Feature: persistence-foundation, Property 17: Empty repository results are absent/empty,
    // never errors. For any Entity_Id that matches no entity in a populated repository, GetByIdAsync
    // still returns an absent result (null) without raising, while present ids resolve.
    // Validates: Requirements 5.4
    [Property(MaxTest = 100)]
    [Trait("Property", "17")]
    public Property PopulatedRepository_GetById_AbsentId_ReturnsNullWithoutError() =>
        Prop.ForAll(Arb.From(PopulatedScenarioGen()), scenario =>
        {
            var (entities, queryId) = scenario;

            var repository = new InMemoryRepository<RepositoryTestEntity>();
            foreach (var entity in entities)
            {
                repository.AddAsync(entity, CancellationToken.None).GetAwaiter().GetResult();
            }

            var result = repository.GetByIdAsync(queryId, CancellationToken.None).GetAwaiter().GetResult();

            // The query id is absent from the stored set => the lookup is a clean miss (null).
            // Guard against the astronomically unlikely v7/random collision: if the id is in fact
            // present, the only required behaviour is that the matching entity is returned.
            return entities.Any(e => e.Id == queryId)
                ? ReferenceEquals(result, entities.First(e => e.Id == queryId))
                : result is null;
        });

    /// <summary>An arbitrary GUID: the all-zero GUID, a UUID version 7, or a random GUID.</summary>
    private static Gen<Guid> AnyGuid() =>
        Gen.OneOf(
            Gen.Constant(Guid.Empty),
            Gen.Constant(0).Select(_ => Guid.CreateVersion7()),
            Gen.Constant(0).Select(_ => Guid.NewGuid()));

    /// <summary>A non-zero GUID: an even mix of UUID version 7 and random GUID values.</summary>
    private static Gen<Guid> NonEmptyGuid() =>
        Gen.OneOf(
            Gen.Constant(0).Select(_ => Guid.CreateVersion7()),
            Gen.Constant(0).Select(_ => Guid.NewGuid()));

    /// <summary>
    /// Generates a repository population (0-10 entities, each with a fresh v7 identity) together
    /// with a separate non-empty query id that is effectively guaranteed not to be among them.
    /// </summary>
    private static Gen<(List<RepositoryTestEntity> Entities, Guid QueryId)> PopulatedScenarioGen() =>
        from count in Gen.Choose(0, 10)
        from queryId in NonEmptyGuid()
        select (Enumerable.Range(0, count).Select(_ => new RepositoryTestEntity()).ToList(), queryId);
}
