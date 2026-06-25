using FsCheck;
using FsCheck.Xunit;
using Microsoft.EntityFrameworkCore;
using PitchMate.Infrastructure.Persistence;
using PitchMate.Infrastructure.Tests.Generators;

namespace PitchMate.Infrastructure.Tests.Persistence;

/// <summary>
/// Property tests for how the save pipeline treats an <c>IAnonymisable</c> entity that has had its
/// PII stripped via <c>Anonymise()</c>, exercised through the production <see cref="EfRepository{T}"/>
/// and <see cref="UnitOfWork"/> over the shared Testcontainers PostgreSQL fixture (a <em>real</em>
/// database — never an in-memory or SQLite substitute). An anonymised entity is just a normal modified
/// entity to the pipeline: saving it stamps <c>UpdatedAt</c>/<c>UpdatedBy</c> (Property 14) while
/// leaving its soft-delete state untouched (Property 15). Determinism comes from the controllable
/// <see cref="FakeTimeProvider"/> and <see cref="FakeCurrentUserAccessor"/>: each test fixes the Clock
/// instant and actor for first persistence, then advances/switches them for the anonymisation save so
/// the moved audit values are observable against the fixed creation provenance; verification reloads
/// rows in a fresh context (bypassing the soft-delete filter where needed).
/// <para>
/// FsCheck's property model is synchronous, so each iteration's asynchronous database work is bridged
/// with <see cref="RunAsync"/> — a deadlock-free block in a test-only context with no synchronization
/// context.
/// </para>
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class AnonymisationPersistencePropertyTests
{
    private readonly PostgreSqlContainerFixture _fixture;

    /// <summary>Receives the shared PostgreSQL container fixture from the collection.</summary>
    /// <param name="fixture">The shared, container-backed persistence fixture.</param>
    public AnonymisationPersistencePropertyTests(PostgreSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    // Feature: persistence-foundation, Property 14: Anonymisation records audit metadata
    /// <summary>
    /// **Validates: Requirements 4.3** — for an anonymisable entity, calling <c>Anonymise()</c> and
    /// saving it (it is a modified entity, so the save pipeline stamps it) updates its <c>UpdatedAt</c>
    /// and <c>UpdatedBy</c> to the current Clock instant and actor, while its <c>CreatedAt</c> and
    /// <c>CreatedBy</c> remain the values recorded at first persistence. The PII is replaced by the
    /// fixed de-identified placeholders.
    /// </summary>
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(AnonymisationArbitraries) })]
    public Property AnonymisationStampsUpdateAuditAndPreservesCreationProvenance(AnonymisationAuditInput input)
    {
        return RunAsync(async () =>
        {
            var clock = new FakeTimeProvider(input.FirstNow);
            var actor = new FakeCurrentUserAccessor(input.FirstActor);

            Guid id;
            await using (var context = _fixture.CreateContext(clock, actor))
            {
                var repository = new EfRepository<PersistenceTestEntity>(context);
                var unitOfWork = new UnitOfWork(context);

                var entity = new PersistenceTestEntity
                {
                    DisplayName = input.DisplayName,
                    Email = input.Email,
                    AvatarUrl = input.AvatarUrl,
                    SkillTier = input.SkillTier,
                    BibCount = input.BibCount,
                };

                await repository.AddAsync(entity, CancellationToken.None);
                await unitOfWork.SaveChangesAsync(CancellationToken.None);
                id = entity.Id;

                // Advance the clock and switch the actor, then anonymise so the save is a genuine
                // update whose UpdatedAt/UpdatedBy move while CreatedAt/CreatedBy stay fixed.
                clock.SetUtcNow(input.AnonymiseNow);
                actor.CurrentUserId = input.AnonymiseActor;
                entity.Anonymise();
                await unitOfWork.SaveChangesAsync(CancellationToken.None);
            }

            await using var verify = _fixture.CreateContext();
            var stored = await verify.TestEntities.FirstOrDefaultAsync(e => e.Id == id);

            return stored is not null
                // Update provenance moved to the anonymisation instant/actor (Req 4.3).
                && stored.UpdatedAt == input.AnonymiseNow
                && stored.UpdatedBy == input.AnonymiseActor
                // Creation provenance preserved from first persistence.
                && stored.CreatedAt == input.FirstNow
                && stored.CreatedBy == input.FirstActor
                // PII replaced with the fixed de-identified placeholders.
                && stored.DisplayName == PersistenceTestEntity.DisplayNamePlaceholder
                && stored.Email is null
                && stored.AvatarUrl is null
                // Non-PII members are unchanged.
                && stored.SkillTier == input.SkillTier
                && stored.BibCount == input.BibCount;
        });
    }

    // Feature: persistence-foundation, Property 15: Anonymisation preserves soft-delete state
    /// <summary>
    /// **Validates: Requirements 4.4** — for anonymisable entities in either soft-delete state,
    /// calling <c>Anonymise()</c> and saving leaves <c>IsDeleted</c> and <c>DeletedAt</c> unchanged.
    /// Each iteration covers both states: an entity that was never soft-deleted (which therefore
    /// remains visible to a default query after anonymisation) and one that was soft-deleted before
    /// anonymisation (whose original <c>DeletedAt</c> grace-start instant is preserved and which
    /// remains hidden from default queries).
    /// </summary>
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(AnonymisationArbitraries) })]
    public Property AnonymisationLeavesSoftDeleteStateUnchanged(AnonymisationSoftDeleteInput input)
    {
        return RunAsync(async () =>
        {
            var clock = new FakeTimeProvider(input.CreateNow);
            var actor = new FakeCurrentUserAccessor(input.Actor);

            Guid liveId;
            Guid deletedId;
            await using (var context = _fixture.CreateContext(clock, actor))
            {
                var repository = new EfRepository<PersistenceTestEntity>(context);
                var unitOfWork = new UnitOfWork(context);

                var live = new PersistenceTestEntity
                {
                    DisplayName = input.LiveDisplayName,
                    Email = input.LiveEmail,
                    SkillTier = input.SkillTier,
                };
                var deleted = new PersistenceTestEntity
                {
                    DisplayName = input.DeletedDisplayName,
                    Email = input.DeletedEmail,
                    SkillTier = input.SkillTier,
                };

                await repository.AddAsync(live, CancellationToken.None);
                await repository.AddAsync(deleted, CancellationToken.None);
                await unitOfWork.SaveChangesAsync(CancellationToken.None);
                liveId = live.Id;
                deletedId = deleted.Id;

                // Soft-delete the second entity at a known instant so its DeletedAt is established.
                clock.SetUtcNow(input.DeleteNow);
                repository.Remove(deleted);
                await unitOfWork.SaveChangesAsync(CancellationToken.None);
            }

            // Anonymise + save each entity at a later instant, in a fresh context, reloading the
            // soft-deleted row with the filter bypassed.
            await using (var context = _fixture.CreateContext(
                new FakeTimeProvider(input.AnonymiseNow),
                actor))
            {
                var repository = new EfRepository<PersistenceTestEntity>(context);
                var unitOfWork = new UnitOfWork(context);

                var live = await context.TestEntities.FirstAsync(e => e.Id == liveId);
                var deleted = await context.TestEntities
                    .IgnoreQueryFilters()
                    .FirstAsync(e => e.Id == deletedId);

                live.Anonymise();
                deleted.Anonymise();
                await unitOfWork.SaveChangesAsync(CancellationToken.None);
            }

            await using var verify = _fixture.CreateContext();

            // The live entity: soft-delete state untouched, still returned by a default query.
            var liveVisibleByDefault = await verify.TestEntities.FirstOrDefaultAsync(e => e.Id == liveId);
            var liveStored = await verify.TestEntities
                .IgnoreQueryFilters()
                .FirstOrDefaultAsync(e => e.Id == liveId);

            // The deleted entity: soft-delete state and original DeletedAt grace-start preserved,
            // still hidden from a default query.
            var deletedVisibleByDefault = await verify.TestEntities.FirstOrDefaultAsync(e => e.Id == deletedId);
            var deletedStored = await verify.TestEntities
                .IgnoreQueryFilters()
                .FirstOrDefaultAsync(e => e.Id == deletedId);

            return liveStored is not null
                && !liveStored.IsDeleted
                && liveStored.DeletedAt is null
                && liveVisibleByDefault is not null
                && deletedStored is not null
                && deletedStored.IsDeleted
                && deletedStored.DeletedAt == input.DeleteNow
                && deletedVisibleByDefault is null;
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
