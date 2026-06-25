using FsCheck;
using FsCheck.Xunit;
using Microsoft.EntityFrameworkCore;
using PitchMate.Application.Common.Persistence;
using PitchMate.Infrastructure.Persistence;
using PitchMate.Infrastructure.Tests.Generators;

namespace PitchMate.Infrastructure.Tests.Persistence;

/// <summary>
/// Property tests for idempotent persistence by client-assigned identity and optimistic concurrency,
/// exercised through the production <see cref="EfRepository{T}"/> and <see cref="UnitOfWork"/> over the
/// shared Testcontainers PostgreSQL fixture (a <em>real</em> database — never an in-memory or SQLite
/// substitute), so the application-supplied <c>uuid</c> key, <c>timestamptz</c> UTC round trip, the
/// PostgreSQL unique-constraint (<c>23505</c>) dedupe, the pre-save id validation, and the <c>xmin</c>
/// concurrency token are all covered against actual PostgreSQL behaviour. Determinism comes from the
/// controllable <see cref="FakeTimeProvider"/> and <see cref="FakeCurrentUserAccessor"/>.
/// <para>
/// FsCheck's property model is synchronous, so each iteration's asynchronous database work is bridged
/// with <see cref="RunAsync"/> — a deadlock-free block in a test-only context with no synchronization
/// context.
/// </para>
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class IdempotentPersistencePropertyTests
{
    private readonly PostgreSqlContainerFixture _fixture;

    /// <summary>Receives the shared PostgreSQL container fixture from the collection.</summary>
    /// <param name="fixture">The shared, container-backed persistence fixture.</param>
    public IdempotentPersistencePropertyTests(PostgreSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    // Feature: persistence-foundation, Property 20: Persistence round trip preserves identity and UTC instants
    /// <summary>
    /// **Validates: Requirements 1.5, 8.5, 9.1** — for any entity stored with a client-assigned
    /// non-zero <c>Entity_Id</c>, reading it back yields the same identity (the application value is
    /// persisted unchanged, with no database-side key generation) and the point-in-time audit values
    /// (<c>CreatedAt</c>/<c>UpdatedAt</c>) read back equal the stored instants expressed in UTC.
    /// </summary>
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(IdempotentPersistenceArbitraries) })]
    public Property StoredEntityRoundTripsIdentityAndUtcInstants(RoundTripInput input)
    {
        return RunAsync(async () =>
        {
            var clock = new FakeTimeProvider(input.ClockNow);
            var actor = new FakeCurrentUserAccessor("round-trip-actor");

            await using (var context = _fixture.CreateContext(clock, actor))
            {
                var repository = new EfRepository<PersistenceTestEntity>(context);
                var unitOfWork = new UnitOfWork(context);

                // Construct with the client-assigned non-zero id; the constructor retains it unchanged.
                var entity = new PersistenceTestEntity(input.Id)
                {
                    DisplayName = input.DisplayName,
                    Email = input.Email,
                    SkillTier = input.SkillTier,
                };

                await repository.AddAsync(entity, CancellationToken.None);
                await unitOfWork.SaveChangesAsync(CancellationToken.None);
            }

            // Read back in a fresh context so the values come from PostgreSQL, not the change tracker.
            await using var verify = _fixture.CreateContext();
            var stored = await verify.TestEntities
                .FirstOrDefaultAsync(e => e.Id == input.Id);

            return stored is not null
                && stored.Id == input.Id                       // identity stored unchanged (Req 1.5, 9.1)
                && stored.CreatedAt == input.ClockNow          // same instant (Req 8.5)
                && stored.UpdatedAt == input.ClockNow
                && stored.CreatedAt.Offset == TimeSpan.Zero     // returned as UTC (Req 8.5)
                && stored.UpdatedAt.Offset == TimeSpan.Zero;
        });
    }

    // Feature: persistence-foundation, Property 21: Duplicate-key dedupe with a distinct error
    /// <summary>
    /// **Validates: Requirements 9.2, 9.3** — for an entity already stored under a given
    /// <c>Entity_Id</c>, adding and saving a second entity with the same id is rejected without creating
    /// a second row and leaves the existing stored row unchanged, surfacing a
    /// <see cref="DuplicateKeyException"/> — a distinct type separable from
    /// <see cref="ConcurrencyConflictException"/> and all other error types.
    /// </summary>
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(IdempotentPersistenceArbitraries) })]
    public Property DuplicateIdIsRejectedWithDistinctErrorAndNoSecondRow(DuplicateKeyInput input)
    {
        return RunAsync(async () =>
        {
            var clock = new FakeTimeProvider(input.ClockNow);
            var actor = new FakeCurrentUserAccessor("duplicate-actor");

            // Store the first entity under the shared id.
            await using (var seedContext = _fixture.CreateContext(clock, actor))
            {
                var seedRepository = new EfRepository<PersistenceTestEntity>(seedContext);
                var seedUnitOfWork = new UnitOfWork(seedContext);

                var first = new PersistenceTestEntity(input.Id)
                {
                    DisplayName = input.FirstDisplayName,
                    SkillTier = input.SkillTier,
                };

                await seedRepository.AddAsync(first, CancellationToken.None);
                await seedUnitOfWork.SaveChangesAsync(CancellationToken.None);
            }

            // Attempt to insert a second entity with the same id in a fresh context (so it is a real
            // INSERT that collides on the primary key rather than a tracked-update).
            var duplicateException = false;
            var distinctFromConcurrency = false;
            await using (var context = _fixture.CreateContext(clock, actor))
            {
                var repository = new EfRepository<PersistenceTestEntity>(context);
                var unitOfWork = new UnitOfWork(context);

                var duplicate = new PersistenceTestEntity(input.Id)
                {
                    DisplayName = input.SecondDisplayName,
                    SkillTier = input.SkillTier,
                };

                await repository.AddAsync(duplicate, CancellationToken.None);

                try
                {
                    await unitOfWork.SaveChangesAsync(CancellationToken.None);
                }
                catch (DuplicateKeyException ex)
                {
                    duplicateException = true;
                    // The distinct type is separable from the concurrency-conflict error and all
                    // other error types (Req 9.3) — checked at runtime so the assertion is explicit.
                    distinctFromConcurrency =
                        ex.GetType() == typeof(DuplicateKeyException)
                        && !typeof(ConcurrencyConflictException).IsInstanceOfType(ex);
                }
            }

            // Verify exactly one row exists under the id and it still holds the first display name.
            await using var verify = _fixture.CreateContext();
            var stored = await verify.TestEntities
                .IgnoreQueryFilters()
                .Where(e => e.Id == input.Id)
                .ToListAsync();

            return duplicateException
                && distinctFromConcurrency
                && stored.Count == 1
                && stored[0].DisplayName == input.FirstDisplayName;
        });
    }

    // Feature: persistence-foundation, Property 22: Invalid identity is rejected before persistence
    /// <summary>
    /// **Validates: Requirements 9.4** — for an entity submitted with an absent/all-zero
    /// <c>Entity_Id</c>, the save is rejected with an <see cref="InvalidEntityIdException"/> before any
    /// I/O and the entity is not persisted. Because <see cref="PitchMate.Domain.Common.BaseEntity"/>
    /// auto-assigns a v7 id at construction, the test forces the all-zero id onto the tracked entity
    /// (via the change tracker) before saving.
    /// </summary>
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(IdempotentPersistenceArbitraries) })]
    public Property AbsentIdentityIsRejectedAndNotPersisted(InvalidIdInput input)
    {
        return RunAsync(async () =>
        {
            var clock = new FakeTimeProvider(input.ClockNow);
            var actor = new FakeCurrentUserAccessor("invalid-id-actor");

            // A unique marker so the "not persisted" check is robust against the shared container.
            var uniqueName = $"{input.DisplayName}-{Guid.NewGuid():N}";

            var rejected = false;
            await using (var context = _fixture.CreateContext(clock, actor))
            {
                var repository = new EfRepository<PersistenceTestEntity>(context);
                var unitOfWork = new UnitOfWork(context);

                var entity = new PersistenceTestEntity
                {
                    DisplayName = uniqueName,
                    SkillTier = input.SkillTier,
                };

                await repository.AddAsync(entity, CancellationToken.None);

                // Force the all-zero id onto the tracked entity (Id has a private setter) so the
                // save-time validation sees an absent identity.
                context.Entry(entity).Property(e => e.Id).CurrentValue = Guid.Empty;

                try
                {
                    await unitOfWork.SaveChangesAsync(CancellationToken.None);
                }
                catch (InvalidEntityIdException)
                {
                    rejected = true;
                }
            }

            // The entity must not have been persisted (validation ran before any I/O).
            await using var verify = _fixture.CreateContext();
            var stored = await verify.TestEntities
                .IgnoreQueryFilters()
                .FirstOrDefaultAsync(e => e.DisplayName == uniqueName);

            return rejected && stored is null;
        });
    }

    // Feature: persistence-foundation, Property 23: Concurrency conflict is surfaced
    /// <summary>
    /// **Validates: Requirements 8.6, 8.7** — for a persisted row loaded into two separate units of
    /// work, once the first update commits (bumping the <c>xmin</c> concurrency token), a subsequent
    /// save of the second (stale) copy surfaces a <see cref="ConcurrencyConflictException"/>, and the
    /// committed (first) value is the one left stored.
    /// </summary>
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(IdempotentPersistenceArbitraries) })]
    public Property StaleUpdateSurfacesConcurrencyConflict(ConcurrencyConflictInput input)
    {
        return RunAsync(async () =>
        {
            var clock = new FakeTimeProvider(input.ClockNow);
            var actor = new FakeCurrentUserAccessor("concurrency-actor");

            // Seed a row to contend over.
            Guid id;
            await using (var seedContext = _fixture.CreateContext(clock, actor))
            {
                var seedRepository = new EfRepository<PersistenceTestEntity>(seedContext);
                var seedUnitOfWork = new UnitOfWork(seedContext);

                var seed = new PersistenceTestEntity
                {
                    DisplayName = input.InitialName,
                    SkillTier = input.SkillTier,
                };

                await seedRepository.AddAsync(seed, CancellationToken.None);
                await seedUnitOfWork.SaveChangesAsync(CancellationToken.None);
                id = seed.Id;
            }

            // Load the same row into two independent contexts (two units of work).
            await using var contextOne = _fixture.CreateContext(clock, actor);
            await using var contextTwo = _fixture.CreateContext(clock, actor);

            var entityOne = await contextOne.TestEntities.FirstAsync(e => e.Id == id);
            var entityTwo = await contextTwo.TestEntities.FirstAsync(e => e.Id == id);

            // First unit of work commits a change — this bumps the xmin token on the row.
            entityOne.DisplayName = input.FirstUpdateName;
            await new UnitOfWork(contextOne).SaveChangesAsync(CancellationToken.None);

            // Second (stale) unit of work now saves its change; the token mismatch must conflict.
            entityTwo.DisplayName = input.SecondUpdateName;
            var conflicted = false;
            try
            {
                await new UnitOfWork(contextTwo).SaveChangesAsync(CancellationToken.None);
            }
            catch (ConcurrencyConflictException)
            {
                conflicted = true;
            }

            // The winning (first) update is the stored value; the stale update did not overwrite it.
            await using var verify = _fixture.CreateContext();
            var stored = await verify.TestEntities.FirstOrDefaultAsync(e => e.Id == id);

            return conflicted
                && stored is not null
                && stored.DisplayName == input.FirstUpdateName;
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
