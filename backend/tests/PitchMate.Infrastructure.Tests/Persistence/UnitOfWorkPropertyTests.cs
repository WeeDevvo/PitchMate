using FsCheck;
using FsCheck.Xunit;
using Microsoft.EntityFrameworkCore;
using PitchMate.Application.Common.Persistence;
using PitchMate.Infrastructure.Persistence;
using PitchMate.Infrastructure.Tests.Generators;

namespace PitchMate.Infrastructure.Tests.Persistence;

/// <summary>
/// Property tests for the <see cref="UnitOfWork"/> save behaviour, exercised through the production
/// <see cref="EfRepository{T}"/> and <see cref="UnitOfWork"/> over the shared Testcontainers
/// PostgreSQL fixture (a <em>real</em> database — never an in-memory or SQLite substitute), so the
/// change-count returned by EF Core's transactional save and its atomic rollback on failure are
/// covered against actual PostgreSQL transaction semantics. Determinism comes from the controllable
/// <see cref="FakeTimeProvider"/> and <see cref="FakeCurrentUserAccessor"/>.
/// <para>
/// FsCheck's property model is synchronous, so each iteration's asynchronous database work is bridged
/// with <see cref="RunAsync"/> — a deadlock-free block in a test-only context with no synchronization
/// context.
/// </para>
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class UnitOfWorkPropertyTests
{
    private readonly PostgreSqlContainerFixture _fixture;

    /// <summary>Receives the shared PostgreSQL container fixture from the collection.</summary>
    /// <param name="fixture">The shared, container-backed persistence fixture.</param>
    public UnitOfWorkPropertyTests(PostgreSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    // Feature: persistence-foundation, Property 18: Unit-of-Work change count
    /// <summary>
    /// **Validates: Requirements 6.4** — for any set of N tracked entity state changes (a mix of
    /// inserts, modifications, and soft-deletes) present at the time of a successful save,
    /// <see cref="UnitOfWork.SaveChangesAsync"/> returns N, and an immediately-following save with no
    /// tracked changes returns zero.
    /// </summary>
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(UnitOfWorkArbitraries) })]
    public Property SaveReturnsCountOfStateChangedEntitiesAndZeroWhenNoChanges(
        UnitOfWorkChangeCountInput input)
    {
        return RunAsync(async () =>
        {
            var clock = new FakeTimeProvider(input.ClockNow);
            var actor = new FakeCurrentUserAccessor(input.Actor);

            await using var context = _fixture.CreateContext(clock, actor);
            var repository = new EfRepository<PersistenceTestEntity>(context);
            var unitOfWork = new UnitOfWork(context);

            // Seed existing rows so there is something to modify and soft-delete in the measured save.
            var seeded = new List<PersistenceTestEntity>();
            for (var i = 0; i < input.SeedCount; i++)
            {
                var entity = new PersistenceTestEntity { DisplayName = $"seed-{i}" };
                await repository.AddAsync(entity, CancellationToken.None);
                seeded.Add(entity);
            }

            if (input.SeedCount > 0)
            {
                await unitOfWork.SaveChangesAsync(CancellationToken.None);
            }

            // Stage the measured mix on the same (still-tracking) context: new inserts, modifications
            // of the first ModifyCount seeded rows, and soft-deletes of the next DeleteCount seeded
            // rows (disjoint ranges), so the expected count is the sum of the three.
            for (var i = 0; i < input.InsertCount; i++)
            {
                var entity = new PersistenceTestEntity { DisplayName = $"insert-{i}" };
                await repository.AddAsync(entity, CancellationToken.None);
            }

            for (var i = 0; i < input.ModifyCount; i++)
            {
                seeded[i].DisplayName = seeded[i].DisplayName + "-modified";
            }

            for (var i = 0; i < input.DeleteCount; i++)
            {
                repository.Remove(seeded[input.ModifyCount + i]);
            }

            var expected = input.InsertCount + input.ModifyCount + input.DeleteCount;
            var measured = await unitOfWork.SaveChangesAsync(CancellationToken.None);

            // With nothing left to persist, a subsequent save reports zero state-changed entities.
            var noChange = await unitOfWork.SaveChangesAsync(CancellationToken.None);

            return measured == expected && noChange == 0;
        });
    }

    // Feature: persistence-foundation, Property 19: Unit-of-Work atomic rollback
    /// <summary>
    /// **Validates: Requirements 6.3, 7.5, 8.8** — for a save bundling a valid modification, a valid
    /// insert, and an invalid insert that fails to persist, the unit of work surfaces a
    /// <see cref="SaveFailedException"/> and persists none of that save's changes: the valid insert
    /// never appears and the modified row is left with its original value.
    /// </summary>
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(UnitOfWorkArbitraries) })]
    public Property FailingSaveRollsBackAllChangesAndSurfacesError(UnitOfWorkRollbackInput input)
    {
        return RunAsync(async () =>
        {
            var clock = new FakeTimeProvider(input.ClockNow);
            var actor = new FakeCurrentUserAccessor(input.Actor);

            // Persist a valid seed row whose value must survive the later failed save unchanged.
            Guid seedId;
            await using (var seedContext = _fixture.CreateContext(clock, actor))
            {
                var seedRepository = new EfRepository<PersistenceTestEntity>(seedContext);
                var seedUnitOfWork = new UnitOfWork(seedContext);

                var seed = new PersistenceTestEntity { DisplayName = input.SeedDisplayName };
                await seedRepository.AddAsync(seed, CancellationToken.None);
                await seedUnitOfWork.SaveChangesAsync(CancellationToken.None);
                seedId = seed.Id;
            }

            // A single save that bundles a modification, a valid insert, and an invalid insert.
            var threw = false;
            Guid goodId;
            await using (var context = _fixture.CreateContext(clock, actor))
            {
                var repository = new EfRepository<PersistenceTestEntity>(context);
                var unitOfWork = new UnitOfWork(context);

                // Change the existing row — this modification must roll back.
                var seed = await context.TestEntities.FirstAsync(e => e.Id == seedId);
                seed.DisplayName = input.ModifiedDisplayName;

                // A valid new row that must NOT be persisted because the save fails atomically.
                var good = new PersistenceTestEntity { DisplayName = input.GoodDisplayName };
                await repository.AddAsync(good, CancellationToken.None);
                goodId = good.Id;

                // An invalid new row: its required display name is missing, so the INSERT violates the
                // NOT NULL constraint and forces the whole save to fail.
                var bad = new PersistenceTestEntity { DisplayName = null! };
                await repository.AddAsync(bad, CancellationToken.None);

                try
                {
                    await unitOfWork.SaveChangesAsync(CancellationToken.None);
                }
                catch (SaveFailedException)
                {
                    threw = true;
                }
            }

            // Verify in a fresh context (filter bypassed so a stray soft-delete could not hide a row).
            await using var verify = _fixture.CreateContext();
            var storedSeed = await verify.TestEntities
                .IgnoreQueryFilters()
                .FirstOrDefaultAsync(e => e.Id == seedId);
            var storedGood = await verify.TestEntities
                .IgnoreQueryFilters()
                .FirstOrDefaultAsync(e => e.Id == goodId);

            return threw
                && storedSeed is not null
                && storedSeed.DisplayName == input.SeedDisplayName // modification rolled back
                && storedGood is null;                             // valid insert rolled back
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
