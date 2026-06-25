using FsCheck;
using FsCheck.Xunit;
using Microsoft.EntityFrameworkCore;
using PitchMate.Infrastructure.Tests.Generators;

namespace PitchMate.Infrastructure.Tests.Persistence;

/// <summary>
/// Property tests for the save-time audit stamping performed by <c>PitchMateDbContext</c>, run
/// against a <em>real</em> PostgreSQL instance via the shared Testcontainers fixture (never an
/// in-memory or SQLite substitute). Determinism comes from the controllable
/// <see cref="FakeTimeProvider"/> and <see cref="FakeCurrentUserAccessor"/>: each test fixes the
/// Clock instant and the acting user, persists, and reloads the row in a fresh context to assert
/// the stamped values were written to the database.
/// <para>
/// FsCheck's property model is synchronous, so each iteration's asynchronous database work is
/// bridged with <see cref="RunAsync"/> (a deliberate, deadlock-free block in a test-only context
/// where there is no synchronization context).
/// </para>
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class AuditStampingPropertyTests
{
    private readonly PostgreSqlContainerFixture _fixture;

    /// <summary>Receives the shared PostgreSQL container fixture from the collection.</summary>
    /// <param name="fixture">The shared, container-backed persistence fixture.</param>
    public AuditStampingPropertyTests(PostgreSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    // Feature: persistence-foundation, Property 5: First-persist audit stamping overrides caller values
    /// <summary>
    /// **Validates: Requirements 2.2, 2.4, 2.8** — after a new entity's first save (even when its
    /// audit fields were pre-set to arbitrary caller values), its <c>CreatedAt</c> and
    /// <c>UpdatedAt</c> both equal the Clock's current UTC instant and its <c>CreatedBy</c> and
    /// <c>UpdatedBy</c> both equal the current actor.
    /// </summary>
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(AuditStampingArbitraries) })]
    public Property FirstPersistAuditStampingOverridesCallerValues(NewEntityAuditValues input)
    {
        return RunAsync(async () =>
        {
            var clock = new FakeTimeProvider(input.ClockNow);
            var actor = new FakeCurrentUserAccessor(input.Actor);

            Guid id;
            await using (var context = _fixture.CreateContext(clock, actor))
            {
                var entity = new PersistenceTestEntity
                {
                    DisplayName = input.DisplayName,
                    Email = input.Email,
                    SkillTier = input.SkillTier,
                    // Deliberately pre-set caller audit values that the save pipeline must override.
                    CreatedAt = input.CallerCreatedAt,
                    UpdatedAt = input.CallerUpdatedAt,
                    CreatedBy = input.CallerCreatedBy,
                    UpdatedBy = input.CallerUpdatedBy,
                };

                context.TestEntities.Add(entity);
                await context.SaveChangesAsync();
                id = entity.Id;
            }

            await using var verify = _fixture.CreateContext();
            var stored = await verify.TestEntities.FirstOrDefaultAsync(e => e.Id == id);

            return stored is not null
                && stored.CreatedAt == input.ClockNow
                && stored.UpdatedAt == input.ClockNow
                && stored.CreatedBy == input.Actor
                && stored.UpdatedBy == input.Actor;
        });
    }

    // Feature: persistence-foundation, Property 6: Update audit stamping preserves creation provenance
    /// <summary>
    /// **Validates: Requirements 2.3, 2.5** — after modifying and saving a persisted entity, its
    /// <c>UpdatedAt</c> equals the current Clock instant and its <c>UpdatedBy</c> equals the current
    /// actor, while its <c>CreatedAt</c> and <c>CreatedBy</c> remain the values recorded at first
    /// persistence.
    /// </summary>
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(AuditStampingArbitraries) })]
    public Property UpdateAuditStampingPreservesCreationProvenance(UpdateAuditValues input)
    {
        return RunAsync(async () =>
        {
            var clock = new FakeTimeProvider(input.FirstNow);
            var actor = new FakeCurrentUserAccessor(input.FirstActor);

            Guid id;
            await using (var context = _fixture.CreateContext(clock, actor))
            {
                var entity = new PersistenceTestEntity
                {
                    DisplayName = input.InitialDisplayName,
                    SkillTier = input.InitialSkillTier,
                };

                context.TestEntities.Add(entity);
                await context.SaveChangesAsync();
                id = entity.Id;

                // Advance the clock and switch the actor, then modify a persisted property so the
                // second save is a genuine update of the same tracked entity.
                clock.SetUtcNow(input.SecondNow);
                actor.CurrentUserId = input.SecondActor;
                entity.DisplayName = input.ModifiedDisplayName;
                await context.SaveChangesAsync();
            }

            await using var verify = _fixture.CreateContext();
            var stored = await verify.TestEntities.FirstOrDefaultAsync(e => e.Id == id);

            return stored is not null
                && stored.CreatedAt == input.FirstNow
                && stored.CreatedBy == input.FirstActor
                && stored.UpdatedAt == input.SecondNow
                && stored.UpdatedBy == input.SecondActor;
        });
    }

    // Feature: persistence-foundation, Property 7: Absent actor is tolerated
    /// <summary>
    /// **Validates: Requirements 2.6** — when the Current_User_Accessor reports no acting user, the
    /// actor identifiers are recorded as <see langword="null"/> (overriding any caller-supplied
    /// values) and the save completes successfully.
    /// </summary>
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(AuditStampingArbitraries) })]
    public Property AbsentActorIsTolerated(AbsentActorAuditValues input)
    {
        return RunAsync(async () =>
        {
            var clock = new FakeTimeProvider(input.ClockNow);
            var actor = new FakeCurrentUserAccessor(currentUserId: null);

            Guid id;
            int saveCount;
            await using (var context = _fixture.CreateContext(clock, actor))
            {
                var entity = new PersistenceTestEntity
                {
                    DisplayName = input.DisplayName,
                    SkillTier = input.SkillTier,
                    // Non-null caller values must still be overridden to null by the save pipeline.
                    CreatedBy = input.CallerCreatedBy,
                    UpdatedBy = input.CallerUpdatedBy,
                };

                context.TestEntities.Add(entity);
                saveCount = await context.SaveChangesAsync();
                id = entity.Id;
            }

            await using var verify = _fixture.CreateContext();
            var stored = await verify.TestEntities.FirstOrDefaultAsync(e => e.Id == id);

            return saveCount == 1
                && stored is not null
                && stored.CreatedBy is null
                && stored.UpdatedBy is null;
        });
    }

    /// <summary>
    /// Bridges FsCheck's synchronous property model to the asynchronous database work each
    /// iteration performs. Blocking here is safe: xUnit test execution has no synchronization
    /// context, so <c>GetAwaiter().GetResult()</c> cannot deadlock, and it surfaces the original
    /// exception unwrapped (unlike <c>.Result</c>/<c>.Wait()</c>).
    /// </summary>
    private static Property RunAsync(Func<Task<bool>> body) =>
        body().GetAwaiter().GetResult().ToProperty();
}
