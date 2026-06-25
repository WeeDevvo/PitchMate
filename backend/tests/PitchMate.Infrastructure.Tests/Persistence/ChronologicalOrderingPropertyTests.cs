using FsCheck;
using FsCheck.Xunit;
using Microsoft.EntityFrameworkCore;
using PitchMate.Domain.Common;
using PitchMate.Infrastructure.Persistence;
using PitchMate.Infrastructure.Tests.Generators;

namespace PitchMate.Infrastructure.Tests.Persistence;

/// <summary>
/// Property test for the database-evaluated chronological ordering (design Property 24, database
/// portion), exercised through the production <see cref="EfRepository{T}.ListChronologicalAsync"/>
/// over the shared Testcontainers PostgreSQL fixture (a <em>real</em> database — never an in-memory
/// or SQLite substitute), so the <c>ORDER BY created_at, id</c> is evaluated inside PostgreSQL and the
/// <c>uuid</c> ordering matches the canonical UUID version 7 byte sequence. Determinism comes from the
/// controllable <see cref="FakeTimeProvider"/> (used to stamp each row's <c>CreatedAt</c> to a known
/// instant, including deliberate ties) and <see cref="FakeCurrentUserAccessor"/>.
/// <para>
/// Because the container's schema is shared across the whole test collection, each iteration tags its
/// rows with a unique batch marker and filters the query result to that batch — the database-evaluated
/// relative order of the batch's rows is preserved by that in-memory filter — then asserts the result
/// equals the same set sorted in memory by the domain <see cref="ChronologicalOrder"/> comparer.
/// </para>
/// <para>
/// FsCheck's property model is synchronous, so each iteration's asynchronous database work is bridged
/// with <see cref="RunAsync"/> — a deadlock-free block in a test-only context with no synchronization
/// context.
/// </para>
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class ChronologicalOrderingPropertyTests
{
    private readonly PostgreSqlContainerFixture _fixture;

    /// <summary>Receives the shared PostgreSQL container fixture from the collection.</summary>
    /// <param name="fixture">The shared, container-backed persistence fixture.</param>
    public ChronologicalOrderingPropertyTests(PostgreSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    // Feature: persistence-foundation, Property 24: Chronological ordering is a deterministic strict total order
    /// <summary>
    /// **Validates: Requirements 9.5, 10.5** — for any set of rows persisted with varying (and
    /// deliberately repeating) <c>CreatedAt</c> instants and a mix of soft-deleted and live rows,
    /// <see cref="EfRepository{T}.ListChronologicalAsync"/> returns the batch's rows in the order
    /// defined by the domain <see cref="ChronologicalOrder"/> comparer (<c>CreatedAt</c> ascending,
    /// then <c>Id</c> ascending by UUID v7 byte sequence) — evaluated inside PostgreSQL — including
    /// soft-deleted rows when <c>includeDeleted</c> is <see langword="true"/> and excluding them when
    /// it is <see langword="false"/>, identical to sorting the expected set in memory regardless of
    /// insertion order.
    /// </summary>
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(ChronologicalOrderingArbitraries) })]
    public Property ListChronologicalEvaluatesDomainOrderInDatabase(ChronologicalOrderingInput input)
    {
        return RunAsync(async () =>
        {
            // A unique marker so this iteration's rows are isolated from the shared container.
            var batch = Guid.NewGuid().ToString("N");
            var clock = new FakeTimeProvider();
            var actor = new FakeCurrentUserAccessor("chronological-order-actor");

            // Persist each row in its generated (arbitrary) order, stamping CreatedAt from the clock
            // set to that row's instant; rows sharing an instant exercise the Id tie-breaker.
            await using (var context = _fixture.CreateContext(clock, actor))
            {
                var repository = new EfRepository<PersistenceTestEntity>(context);
                var unitOfWork = new UnitOfWork(context);

                for (var i = 0; i < input.Items.Count; i++)
                {
                    var item = input.Items[i];

                    clock.SetUtcNow(item.CreatedAt);
                    var entity = new PersistenceTestEntity { DisplayName = $"{batch}-{i}" };
                    await repository.AddAsync(entity, CancellationToken.None);
                    await unitOfWork.SaveChangesAsync(CancellationToken.None);

                    if (item.IsDeleted)
                    {
                        repository.Remove(entity);
                        await unitOfWork.SaveChangesAsync(CancellationToken.None);
                    }
                }
            }

            // Read back the chronological list (DB-evaluated order) and the authoritative stored rows
            // for this batch in fresh contexts so the values come from PostgreSQL, not a change tracker.
            await using var verify = _fixture.CreateContext();
            var verifyRepository = new EfRepository<PersistenceTestEntity>(verify);

            var dbOrdered = (await verifyRepository.ListChronologicalAsync(input.IncludeDeleted, CancellationToken.None))
                .Where(e => e.DisplayName.StartsWith(batch, StringComparison.Ordinal))
                .Select(e => e.Id)
                .ToList();

            // The authoritative stored rows for the batch (filter bypassed so soft-deleted rows are
            // available), used to compute the expected in-memory ordering.
            var storedBatch = await verify.TestEntities
                .IgnoreQueryFilters()
                .Where(e => e.DisplayName.StartsWith(batch))
                .ToListAsync();

            // Expected: the same set, honouring the soft-delete visibility request, sorted by the
            // domain ChronologicalOrder comparer (CreatedAt asc, then Id asc by UUID v7 bytes).
            var expectedOrdered = storedBatch
                .Where(e => input.IncludeDeleted || !e.IsDeleted)
                .OrderBy(e => e, ChronologicalOrder.Instance)
                .Select(e => e.Id)
                .ToList();

            // The database-evaluated order must equal the in-memory comparer order exactly (and so the
            // soft-delete visibility must match too).
            return dbOrdered.SequenceEqual(expectedOrdered);
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
