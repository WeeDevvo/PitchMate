using FsCheck;
using FsCheck.Xunit;
using Microsoft.EntityFrameworkCore;
using PitchMate.Infrastructure.Persistence;
using PitchMate.Infrastructure.Tests.Generators;

namespace PitchMate.Infrastructure.Tests.Persistence;

/// <summary>
/// Property tests for the save-time soft-delete behaviour of <c>PitchMateDbContext</c>, exercised
/// through the production <see cref="EfRepository{T}"/> and <see cref="UnitOfWork"/> over the shared
/// Testcontainers PostgreSQL fixture (a <em>real</em> database — never an in-memory or SQLite
/// substitute), so the context's reinterpretation of an EF <c>Deleted</c> state into a soft-delete is
/// covered end to end. Determinism comes from the controllable <see cref="FakeTimeProvider"/> and
/// <see cref="FakeCurrentUserAccessor"/>: each test fixes the Clock instant for the deletion so the
/// recorded <c>DeletedAt</c> can be asserted exactly, and verification reloads rows in a fresh context
/// (using <see cref="EntityFrameworkQueryableExtensions.IgnoreQueryFilters{TEntity}"/> where needed to
/// see soft-deleted rows).
/// <para>
/// FsCheck's property model is synchronous, so each iteration's asynchronous database work is bridged
/// with <see cref="RunAsync"/> — a deadlock-free block in a test-only context with no synchronization
/// context.
/// </para>
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class SoftDeletePropertyTests
{
    private readonly PostgreSqlContainerFixture _fixture;

    /// <summary>Receives the shared PostgreSQL container fixture from the collection.</summary>
    /// <param name="fixture">The shared, container-backed persistence fixture.</param>
    public SoftDeletePropertyTests(PostgreSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    // Feature: persistence-foundation, Property 8: Soft-delete transition
    /// <summary>
    /// **Validates: Requirements 3.2** — for a soft-deletable entity whose <c>IsDeleted</c> is false,
    /// requesting deletion through the repository and committing through the unit of work sets
    /// <c>IsDeleted</c> to true, sets <c>DeletedAt</c> to the current Clock instant, and retains the row
    /// in the database.
    /// </summary>
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(SoftDeleteArbitraries) })]
    public Property SoftDeleteTransitionSetsFlagAndStampAndRetainsRow(SoftDeleteTransitionInput input)
    {
        return RunAsync(async () =>
        {
            var clock = new FakeTimeProvider(input.CreateNow);
            var actor = new FakeCurrentUserAccessor(input.Actor);

            Guid id;
            await using (var context = _fixture.CreateContext(clock, actor))
            {
                var repository = new EfRepository<PersistenceTestEntity>(context);
                var unitOfWork = new UnitOfWork(context);

                var entity = new PersistenceTestEntity
                {
                    DisplayName = input.DisplayName,
                    Email = input.Email,
                    SkillTier = input.SkillTier,
                };

                await repository.AddAsync(entity, CancellationToken.None);
                await unitOfWork.SaveChangesAsync(CancellationToken.None);
                id = entity.Id;

                // Move the clock to the deletion instant so DeletedAt is asserted against a known value.
                clock.SetUtcNow(input.DeleteNow);
                repository.Remove(entity);
                await unitOfWork.SaveChangesAsync(CancellationToken.None);
            }

            await using var verify = _fixture.CreateContext();

            // The row must be retained: it is invisible to a default query (global filter) but
            // present when the filter is bypassed.
            var visibleByDefault = await verify.TestEntities
                .FirstOrDefaultAsync(e => e.Id == id);
            var stored = await verify.TestEntities
                .IgnoreQueryFilters()
                .FirstOrDefaultAsync(e => e.Id == id);

            return visibleByDefault is null
                && stored is not null
                && stored.IsDeleted
                && stored.DeletedAt == input.DeleteNow;
        });
    }

    // Feature: persistence-foundation, Property 9: Soft-delete query visibility
    /// <summary>
    /// **Validates: Requirements 3.3, 3.4** — for a set of soft-deletable entities, a default query
    /// (honouring the global query filter) returns only those whose <c>IsDeleted</c> is false, while an
    /// explicit include-deleted query (<c>ListChronologicalAsync(includeDeleted: true)</c>, which
    /// bypasses the filter) returns every entity regardless of its <c>IsDeleted</c> value.
    /// </summary>
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(SoftDeleteArbitraries) })]
    public Property DefaultQueryHidesDeletedWhileIncludeDeletedReturnsAll(SoftDeleteVisibilityInput input)
    {
        return RunAsync(async () =>
        {
            var clock = new FakeTimeProvider(input.CreateNow);
            var actor = new FakeCurrentUserAccessor("visibility-actor");

            var insertedIds = new List<Guid>();
            var deletedIds = new HashSet<Guid>();
            var liveIds = new HashSet<Guid>();

            await using (var context = _fixture.CreateContext(clock, actor))
            {
                var repository = new EfRepository<PersistenceTestEntity>(context);
                var unitOfWork = new UnitOfWork(context);

                var entities = new List<(PersistenceTestEntity Entity, bool Delete)>();
                foreach (var item in input.Items)
                {
                    var entity = new PersistenceTestEntity { DisplayName = item.DisplayName };
                    await repository.AddAsync(entity, CancellationToken.None);
                    entities.Add((entity, item.Delete));
                }

                await unitOfWork.SaveChangesAsync(CancellationToken.None);

                clock.SetUtcNow(input.DeleteNow);
                foreach (var (entity, delete) in entities)
                {
                    insertedIds.Add(entity.Id);
                    if (delete)
                    {
                        repository.Remove(entity);
                        deletedIds.Add(entity.Id);
                    }
                    else
                    {
                        liveIds.Add(entity.Id);
                    }
                }

                await unitOfWork.SaveChangesAsync(CancellationToken.None);
            }

            await using var verify = _fixture.CreateContext();
            var verifyRepository = new EfRepository<PersistenceTestEntity>(verify);

            // Restrict both views to the ids this iteration inserted, so rows persisted by other
            // iterations or test classes in the shared container do not affect the assertions.
            var insertedSet = insertedIds.ToHashSet();

            var defaultVisible = (await verifyRepository.ListAsync(CancellationToken.None))
                .Select(e => e.Id)
                .Where(insertedSet.Contains)
                .ToHashSet();

            var includeDeletedVisible = (await verifyRepository.ListChronologicalAsync(
                    includeDeleted: true,
                    CancellationToken.None))
                .Select(e => e.Id)
                .Where(insertedSet.Contains)
                .ToHashSet();

            // Default query returns exactly the non-deleted members; include-deleted returns all.
            return defaultVisible.SetEquals(liveIds)
                && !defaultVisible.Overlaps(deletedIds)
                && includeDeletedVisible.SetEquals(insertedSet);
        });
    }

    // Feature: persistence-foundation, Property 11: Soft-delete idempotence preserves grace start
    /// <summary>
    /// **Validates: Requirements 3.7** — for a soft-deletable entity whose <c>IsDeleted</c> is already
    /// true, requesting deletion again (at a strictly-later Clock instant) leaves its <c>IsDeleted</c>
    /// and <c>DeletedAt</c> values unchanged — preserving the original grace-period start — and retains
    /// the row.
    /// </summary>
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(SoftDeleteArbitraries) })]
    public Property RedeletingPreservesOriginalDeletedAtAndRetainsRow(SoftDeleteIdempotenceInput input)
    {
        return RunAsync(async () =>
        {
            var clock = new FakeTimeProvider(input.CreateNow);
            var actor = new FakeCurrentUserAccessor(input.Actor);

            Guid id;
            await using (var context = _fixture.CreateContext(clock, actor))
            {
                var repository = new EfRepository<PersistenceTestEntity>(context);
                var unitOfWork = new UnitOfWork(context);

                var entity = new PersistenceTestEntity
                {
                    DisplayName = input.DisplayName,
                    SkillTier = input.SkillTier,
                };

                await repository.AddAsync(entity, CancellationToken.None);
                await unitOfWork.SaveChangesAsync(CancellationToken.None);
                id = entity.Id;

                // First deletion establishes the grace-period start at FirstDeleteNow.
                clock.SetUtcNow(input.FirstDeleteNow);
                repository.Remove(entity);
                await unitOfWork.SaveChangesAsync(CancellationToken.None);
            }

            int secondSaveCount;
            await using (var context = _fixture.CreateContext(
                new FakeTimeProvider(input.SecondDeleteNow),
                actor))
            {
                var repository = new EfRepository<PersistenceTestEntity>(context);
                var unitOfWork = new UnitOfWork(context);

                // Reload the already-deleted row (filter bypassed) and request deletion again.
                var deleted = await context.TestEntities
                    .IgnoreQueryFilters()
                    .FirstAsync(e => e.Id == id);

                repository.Remove(deleted);
                secondSaveCount = await unitOfWork.SaveChangesAsync(CancellationToken.None);
            }

            await using var verify = _fixture.CreateContext();
            var stored = await verify.TestEntities
                .IgnoreQueryFilters()
                .FirstOrDefaultAsync(e => e.Id == id);

            // Re-deletion is a no-op: no state change persisted, and DeletedAt keeps the first instant.
            return secondSaveCount == 0
                && stored is not null
                && stored.IsDeleted
                && stored.DeletedAt == input.FirstDeleteNow;
        });
    }

    // Feature: persistence-foundation, Property 12: Restore round trip
    /// <summary>
    /// **Validates: Requirements 3.8** — for a soft-deleted entity, requesting restore through the
    /// repository and committing through the unit of work sets <c>IsDeleted</c> to false, records
    /// <c>DeletedAt</c> as absent, and retains the row, so the entity is once again returned by default
    /// queries.
    /// </summary>
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(SoftDeleteArbitraries) })]
    public Property RestoreClearsDeletionStateAndRetainsRow(RestoreRoundTripInput input)
    {
        return RunAsync(async () =>
        {
            var clock = new FakeTimeProvider(input.CreateNow);
            var actor = new FakeCurrentUserAccessor(input.Actor);

            Guid id;
            await using (var context = _fixture.CreateContext(clock, actor))
            {
                var repository = new EfRepository<PersistenceTestEntity>(context);
                var unitOfWork = new UnitOfWork(context);

                var entity = new PersistenceTestEntity
                {
                    DisplayName = input.DisplayName,
                    SkillTier = input.SkillTier,
                };

                await repository.AddAsync(entity, CancellationToken.None);
                await unitOfWork.SaveChangesAsync(CancellationToken.None);
                id = entity.Id;

                clock.SetUtcNow(input.DeleteNow);
                repository.Remove(entity);
                await unitOfWork.SaveChangesAsync(CancellationToken.None);
            }

            await using (var context = _fixture.CreateContext(
                new FakeTimeProvider(input.RestoreNow),
                actor))
            {
                var repository = new EfRepository<PersistenceTestEntity>(context);
                var unitOfWork = new UnitOfWork(context);

                // Reload the soft-deleted row (filter bypassed) and restore it.
                var deleted = await context.TestEntities
                    .IgnoreQueryFilters()
                    .FirstAsync(e => e.Id == id);

                repository.Restore(deleted);
                await unitOfWork.SaveChangesAsync(CancellationToken.None);
            }

            await using var verify = _fixture.CreateContext();

            // After restore the row is retained and visible to a default query again.
            var visibleByDefault = await verify.TestEntities
                .FirstOrDefaultAsync(e => e.Id == id);
            var stored = await verify.TestEntities
                .IgnoreQueryFilters()
                .FirstOrDefaultAsync(e => e.Id == id);

            return stored is not null
                && !stored.IsDeleted
                && stored.DeletedAt is null
                && visibleByDefault is not null;
        });
    }

    /// <summary>
    /// Bridges FsCheck's synchronous property model to the asynchronous database work each iteration
    /// performs. Blocking here is safe: xUnit test execution has no synchronization context, so
    /// <c>GetAwaiter().GetResult()</c> cannot deadlock, and it surfaces the original exception
    /// unwrapped (unlike <c>.Result</c>/<c>.Wait()</c>).
    /// </summary>
    private static Property RunAsync(Func<Task<bool>> body) =>
        body().GetAwaiter().GetResult().ToProperty();
}
