using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using PitchMate.Infrastructure.Tests.Persistence.Migrations;

namespace PitchMate.Infrastructure.Tests.Persistence;

/// <summary>
/// Integration tests for the migration bundle runner contract (Requirements 12.4–12.6), exercised
/// against a <em>real</em> PostgreSQL instance via the shared Testcontainers fixture.
/// <para>
/// The deploy-step runner is an EF Core migration bundle (<c>efbundle</c>) — a self-contained
/// executable produced by <c>dotnet ef migrations bundle</c>. The bundle is a thin wrapper that
/// invokes EF Core's <see cref="IMigrator"/> against the embedded migrations; its apply/ordering,
/// failure stop/rollback, and no-pending behaviours are EF Core guarantees (documented in
/// <c>docs/migrations.md</c>). Building and running the compiled executable inside the test suite
/// would require the <c>dotnet-ef</c> tool, a Release build, and a runtime-matched publish on every
/// CI agent — fragile and slow — so these tests exercise the wrapped <see cref="IMigrator"/>
/// directly, which is the exact behaviour the bundle exhibits. Each test uses its own freshly
/// created, empty database and a representative test-only migration set.
/// </para>
/// <para>Validates: Requirements 12.4, 12.5, 12.6.</para>
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class MigrationBundleRunnerIntegrationTests
{
    private const string BundleMigrationOneId = "20300101000001_CreateBundleOne";
    private const string BundleMigrationTwoId = "20300101000002_CreateBundleTwo";
    private const string FailingMigrationOneId = "20300201000001_CreateFailingOne";
    private const string FailingMigrationTwoId = "20300201000002_CreateFailingTwo";

    private readonly PostgreSqlContainerFixture _fixture;

    /// <summary>Receives the shared PostgreSQL container fixture from the collection.</summary>
    /// <param name="fixture">The shared, container-backed persistence fixture.</param>
    public MigrationBundleRunnerIntegrationTests(PostgreSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    // Requirement 12.4 — against a database with pending migrations, the runner applies them in order
    // and terminates successfully identifying the applied migrations.
    /// <summary>
    /// Running the migrator against a database with two pending migrations applies both in order,
    /// creating each migration's table, and reports both migration identifiers as applied in order.
    /// </summary>
    [Fact]
    public async Task RunnerWithPendingMigrations_AppliesThemInOrderAndReportsApplied()
    {
        await WithFreshDatabaseAsync(async connectionString =>
        {
            await using var context = new BundleMigrationsDbContext(
                MigrationTestSupport.BuildContextOptions<BundleMigrationsDbContext>(connectionString));

            var migrator = context.GetService<IMigrator>();
            await migrator.MigrateAsync();

            // Both migrations are recorded, in order (Req 12.4).
            var applied = (await context.Database.GetAppliedMigrationsAsync()).ToList();
            Assert.Equal(new[] { BundleMigrationOneId, BundleMigrationTwoId }, applied);

            // Each migration's table now exists.
            Assert.True(await MigrationTestSupport.TableExistsAsync(connectionString, "public", "bundle_one"));
            Assert.True(await MigrationTestSupport.TableExistsAsync(connectionString, "public", "bundle_two"));

            // Nothing remains pending.
            Assert.Empty(await context.Database.GetPendingMigrationsAsync());
        });
    }

    // Requirement 12.5 — on failure the runner stops before later migrations, leaves already-applied
    // migrations intact, rolls back the failed migration, and surfaces a failure identifying it.
    /// <summary>
    /// When a later migration fails, the migrator surfaces the error, the earlier migration stays
    /// applied with its table intact, the failed migration is rolled back (its partial table absent
    /// and not recorded in history), and the failed migration remains identifiable as the pending
    /// one that did not apply.
    /// </summary>
    [Fact]
    public async Task RunnerOnFailure_StopsRollsBackFailedMigrationAndLeavesPriorIntact()
    {
        await WithFreshDatabaseAsync(async connectionString =>
        {
            await using var context = new FailingMigrationsDbContext(
                MigrationTestSupport.BuildContextOptions<FailingMigrationsDbContext>(connectionString));

            var migrator = context.GetService<IMigrator>();

            // The failed migration surfaces an error (Req 12.5).
            await Assert.ThrowsAnyAsync<Exception>(() => migrator.MigrateAsync());

            // The earlier migration stayed applied and its table is intact (Req 12.5).
            var applied = (await context.Database.GetAppliedMigrationsAsync()).ToList();
            Assert.Equal(new[] { FailingMigrationOneId }, applied);
            Assert.True(await MigrationTestSupport.TableExistsAsync(connectionString, "public", "failrun_one"));

            // The failed migration was rolled back: its partial table is gone (Req 12.5).
            Assert.False(await MigrationTestSupport.TableExistsAsync(
                connectionString, "public", CreateFailingTwo.PartialTableName));

            // The failed migration remains identifiable as the one still pending (Req 12.5).
            var pending = (await context.Database.GetPendingMigrationsAsync()).ToList();
            Assert.Contains(FailingMigrationTwoId, pending);
        });
    }

    // Requirement 12.6 — against a database with no pending migrations, the runner makes no schema
    // changes and reports success.
    /// <summary>
    /// Running the migrator a second time, when all migrations are already applied, makes no schema
    /// changes and completes successfully (a no-op).
    /// </summary>
    [Fact]
    public async Task RunnerWithNoPendingMigrations_MakesNoChangesAndReportsSuccess()
    {
        await WithFreshDatabaseAsync(async connectionString =>
        {
            await using var context = new BundleMigrationsDbContext(
                MigrationTestSupport.BuildContextOptions<BundleMigrationsDbContext>(connectionString));

            var migrator = context.GetService<IMigrator>();

            // First run applies everything.
            await migrator.MigrateAsync();
            Assert.Empty(await context.Database.GetPendingMigrationsAsync());

            var tablesBefore = (await MigrationTestSupport.ListPublicTablesAsync(connectionString))
                .OrderBy(t => t, StringComparer.Ordinal).ToList();

            // Second run is a no-op success: no throw, no schema change (Req 12.6).
            await migrator.MigrateAsync();

            var tablesAfter = (await MigrationTestSupport.ListPublicTablesAsync(connectionString))
                .OrderBy(t => t, StringComparer.Ordinal).ToList();

            Assert.Equal(tablesBefore, tablesAfter);
            Assert.Equal(
                new[] { BundleMigrationOneId, BundleMigrationTwoId },
                (await context.Database.GetAppliedMigrationsAsync()).ToList());
        });
    }

    /// <summary>
    /// Creates a uniquely-named empty database on the shared server, runs the test body against a
    /// connection string targeting it, and drops it afterwards regardless of outcome.
    /// </summary>
    private async Task WithFreshDatabaseAsync(Func<string, Task> body)
    {
        var databaseName = "mig_" + Guid.NewGuid().ToString("N");
        await MigrationTestSupport.CreateDatabaseAsync(_fixture.ConnectionString, databaseName);

        try
        {
            var connectionString =
                MigrationTestSupport.ConnectionStringForDatabase(_fixture.ConnectionString, databaseName);
            await body(connectionString);
        }
        finally
        {
            await MigrationTestSupport.DropDatabaseAsync(_fixture.ConnectionString, databaseName);
        }
    }
}
