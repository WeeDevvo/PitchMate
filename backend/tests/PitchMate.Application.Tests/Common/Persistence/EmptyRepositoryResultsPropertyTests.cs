using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Application.Tests.Fakes;
using PitchMate.Domain.Common;

namespace PitchMate.Application.Tests.Common.Persistence;

/// <summary>
/// Property-based tests for empty / unmatched repository results (persistence-foundation design
/// Property 17). They exercise the hand-written in-memory <see cref="InMemoryRepository{T}"/> fake
/// — a faithful, dictionary-backed model of the Application-layer
/// <see cref="PitchMate.Application.Common.Persistence.IRepository{T}"/> contract — to assert that
/// the absence of a match is always communicated as an absent value or an empty collection, and
/// never as a thrown error.
/// <para>
/// Specifically: a retrieve-by-id for an <see cref="System.Guid"/> that is not present returns
/// <c>null</c> without throwing (Requirement 5.4); and a collection retrieve over a repository with
/// no matching entities returns a non-null, empty collection without throwing (Requirement 5.5),
/// whether the repository was never populated or had every entity soft-deleted out of view.
/// </para>
/// </summary>
[Trait("Feature", "persistence-foundation")]
public class EmptyRepositoryResultsPropertyTests
{
    // Feature: persistence-foundation, Property 17: Empty repository results are absent/empty,
    // never errors - retrieving by an Entity_Id that is not present (in an arbitrarily populated
    // repository) returns an absent result (null) and raises no error. Validates: Requirements 5.4
    [Property(MaxTest = 100)]
    [Trait("Property", "17: Empty repository results are absent/empty, never errors")]
    public Property UnmatchedIdReturnsAbsentWithoutError() =>
        Prop.ForAll(Arb.From(UnmatchedLookupGen()), scenario =>
        {
            var repository = new InMemoryRepository<RepositoryTestEntity>();

            foreach (var entity in scenario.Present)
            {
                repository.AddAsync(entity, CancellationToken.None).GetAwaiter().GetResult();
            }

            var result = repository
                .GetByIdAsync(scenario.MissingId, CancellationToken.None)
                .GetAwaiter()
                .GetResult();

            return result is null;
        });

    // Feature: persistence-foundation, Property 17: Empty repository results are absent/empty,
    // never errors - when no entities match, both ListAsync and ListChronologicalAsync return a
    // non-null, empty collection and raise no error. This covers a repository that was never
    // populated and one whose every entity has been soft-deleted out of the default view.
    // Validates: Requirements 5.5
    [Property(MaxTest = 100)]
    [Trait("Property", "17: Empty repository results are absent/empty, never errors")]
    public Property NoMatchesReturnsEmptyCollectionWithoutError() =>
        Prop.ForAll(Arb.From(EmptyViewGen()), entities =>
        {
            var repository = new InMemoryRepository<RepositoryTestEntity>();

            // Populate then remove every entity so the default (non-deleted) view is empty.
            foreach (var entity in entities)
            {
                repository.AddAsync(entity, CancellationToken.None).GetAwaiter().GetResult();
            }

            foreach (var entity in entities)
            {
                repository.Remove(entity);
            }

            var list = repository.ListAsync(CancellationToken.None).GetAwaiter().GetResult();
            var chronological = repository
                .ListChronologicalAsync(includeDeleted: false, CancellationToken.None)
                .GetAwaiter()
                .GetResult();

            return list is not null
                && list.Count == 0
                && chronological is not null
                && chronological.Count == 0;
        });

    /// <summary>
    /// A lookup scenario: a set of entities present in the repository plus a distinct
    /// <see cref="System.Guid"/> guaranteed not to match any of them.
    /// </summary>
    private sealed record UnmatchedLookup(IReadOnlyList<RepositoryTestEntity> Present, Guid MissingId);

    /// <summary>
    /// Generates an arbitrarily populated repository (including the empty case) together with a
    /// missing id. The missing id is drawn from the full GUID space (including <see cref="Guid.Empty"/>
    /// and arbitrary GUIDs) and re-rolled to a fresh value on the vanishingly rare chance it collides
    /// with a present entity, so the lookup is always genuinely unmatched.
    /// </summary>
    private static Gen<UnmatchedLookup> UnmatchedLookupGen() =>
        from count in Gen.Choose(0, 12)
        from present in Gen.ListOf(EntityGen(), count)
        from candidate in MissingIdGen()
        let presentIds = present.Select(e => e.Id).ToHashSet()
        let missingId = presentIds.Contains(candidate) ? Guid.CreateVersion7() : candidate
        select new UnmatchedLookup(present.ToList(), missingId);

    /// <summary>Generates a set of entities (including the empty set) for the empty-view scenarios.</summary>
    private static Gen<List<RepositoryTestEntity>> EmptyViewGen() =>
        from count in Gen.Choose(0, 12)
        from entities in Gen.ListOf(EntityGen(), count)
        select entities.ToList();

    /// <summary>Generates an entity with a fresh UUID version 7 identity and an arbitrary optional name.</summary>
    private static Gen<RepositoryTestEntity> EntityGen() =>
        from hasName in Gen.Elements(true, false)
        from suffix in Gen.Choose(0, 1_000_000)
        select new RepositoryTestEntity { Name = hasName ? $"name-{suffix}" : null };

    /// <summary>A candidate "missing" id: the all-zero GUID, a UUID version 7, or an arbitrary GUID.</summary>
    private static Gen<Guid> MissingIdGen()
    {
        var arbitraryGuid =
            from a in Gen.Choose(int.MinValue, int.MaxValue)
            from b in Gen.Choose(int.MinValue, int.MaxValue)
            from c in Gen.Choose(int.MinValue, int.MaxValue)
            from d in Gen.Choose(int.MinValue, int.MaxValue)
            select GuidFromInts(a, b, c, d);

        return Gen.OneOf(
            Gen.Constant(Guid.Empty),
            Gen.Constant(0).Select(_ => Guid.CreateVersion7()),
            arbitraryGuid);
    }

    private static Guid GuidFromInts(int a, int b, int c, int d)
    {
        var bytes = new byte[16];
        BitConverter.GetBytes(a).CopyTo(bytes, 0);
        BitConverter.GetBytes(b).CopyTo(bytes, 4);
        BitConverter.GetBytes(c).CopyTo(bytes, 8);
        BitConverter.GetBytes(d).CopyTo(bytes, 12);
        return new Guid(bytes);
    }
}
