using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using PitchMate.Infrastructure.Persistence;
using PitchMate.Infrastructure.Tests.Persistence.Migrations;

namespace PitchMate.Infrastructure.Tests.Persistence;

/// <summary>
/// Integration tests for the initial EF Core migration, exercised against a <em>real</em>
/// PostgreSQL instance via the shared Testcontainers fixture — never the EF in-memory provider or
/// SQLite (Requirement 11.5). Each test runs against its own freshly created, empty database on the
/// shared server so it observes the migration applied to a clean baseline.
/// <para>
/// The production <see cref="PitchMateDbContext"/> defines no concrete entities yet, so the initial
/// migration's <c>Up</c>/<c>Down</c> are empty: applying it creates exactly the model's tables
/// (currently none) plus the migrations-history table and row. The schema assertions are derived
/// generically from <see cref="DbContext.Model"/>, so they assert "every model-defined table, PK,
/// FK, and index exists" correctly today and continue to hold as feature specs add entities. The
/// "force a failing apply leaves no partial schema" case uses a representative failing migration
/// (<see cref="FailingMigrationsDbContext"/>) because the empty initial migration cannot itself
/// fail.
/// </para>
/// <para>Validates: Requirements 11.2, 11.3, 11.5, 11.6, 11.7.</para>
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class InitialMigrationIntegrationTests
{
    /// <summary>The identifier of the one and only initial migration in the Infrastructure project.</summary>
    private const string InitialMigrationId = "20260625201240_InitialCreate";

    private readonly PostgreSqlContainerFixture _fixture;

    /// <summary>Receives the shared PostgreSQL container fixture from the collection.</summary>
    /// <param name="fixture">The shared, container-backed persistence fixture.</param>
    public InitialMigrationIntegrationTests(PostgreSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    // Requirements 11.2, 11.5 — apply the initial migration to an empty database and confirm every
    // model-defined table/PK/FK/index exists, plus a single migrations-history row, using real
    // PostgreSQL.
    /// <summary>
    /// Applying the initial migration to an empty database creates exactly the tables, primary keys,
    /// foreign keys, and indexes defined by the model (verified against PostgreSQL's catalog), and
    /// records the migration's identifier as the single row in the migrations-history table.
    /// </summary>
    [Fact]
    public async Task ApplyingInitialMigrationToEmptyDatabase_CreatesModelObjectsAndRecordsHistoryRow()
    {
        await WithFreshDatabaseAsync(async connectionString =>
        {
            await using var context = CreateContext(connectionString);

            await context.Database.MigrateAsync();

            // The migration records exactly its identifier in the history (Req 11.2).
            var applied = (await context.Database.GetAppliedMigrationsAsync()).ToList();
            Assert.Equal(new[] { InitialMigrationId }, applied);

            // The migrations-history table itself exists.
            Assert.True(await MigrationTestSupport.TableExistsAsync(
                connectionString, "public", MigrationTestSupport.HistoryTableName));

            // Every model-defined table/PK/FK/index exists and the schema contains nothing beyond
            // the model's tables (Req 11.2, 11.5).
            await AssertSchemaMatchesModelAsync(context, connectionString);
        });
    }

    // Requirement 11.3 — the down operation drops everything the migration created, removes its
    // history row, and returns the database to its pre-migration empty state.
    /// <summary>
    /// Running the migration's down operation removes the migrations-history row and leaves no
    /// model-defined tables, returning the database to its pre-migration empty state.
    /// </summary>
    [Fact]
    public async Task RunningDownOnInitialMigration_RemovesHistoryRowAndReturnsToEmptyState()
    {
        await WithFreshDatabaseAsync(async connectionString =>
        {
            await using var context = CreateContext(connectionString);

            await context.Database.MigrateAsync();

            // Revert to before the first migration ("0" == Migration.InitialDatabase).
            var migrator = context.GetService<IMigrator>();
            await migrator.MigrateAsync(Migration.InitialDatabase);

            // The history row is gone (Req 11.3).
            var applied = await context.Database.GetAppliedMigrationsAsync();
            Assert.Empty(applied);

            // No model-defined tables remain (Req 11.3).
            var modelTables = await MigrationTestSupport.ListModelTablesAsync(connectionString);
            Assert.Empty(modelTables);
        });
    }

    // Requirement 11.7 — applying the migration when it is already recorded makes no schema changes
    // and reports success (a no-op).
    /// <summary>
    /// Re-applying the initial migration to a database that already records it makes no schema
    /// changes and completes successfully, with the history still holding the single migration row.
    /// </summary>
    [Fact]
    public async Task ReapplyingInitialMigrationWhenAlreadyRecorded_IsNoOpThatReportsSuccess()
    {
        await WithFreshDatabaseAsync(async connectionString =>
        {
            await using var context = CreateContext(connectionString);

            await context.Database.MigrateAsync();

            // Nothing is pending after the first apply.
            Assert.Empty(await context.Database.GetPendingMigrationsAsync());

            var tablesBefore = (await MigrationTestSupport.ListPublicTablesAsync(connectionString))
                .OrderBy(t => t, StringComparer.Ordinal).ToList();

            // Re-apply: must not throw and must not change the schema (Req 11.7).
            await context.Database.MigrateAsync();

            var tablesAfter = (await MigrationTestSupport.ListPublicTablesAsync(connectionString))
                .OrderBy(t => t, StringComparer.Ordinal).ToList();

            Assert.Equal(tablesBefore, tablesAfter);
            Assert.Equal(
                new[] { InitialMigrationId },
                (await context.Database.GetAppliedMigrationsAsync()).ToList());
        });
    }

    // Requirement 11.6 — if applying a migration fails before completion, leave no partial schema and
    // surface an error. The empty initial migration cannot fail, so a representative failing
    // migration validates the guarantee.
    /// <summary>
    /// When a migration fails partway through its <c>Up</c>, the error surfaces to the caller and the
    /// partial schema it had begun creating is rolled back, leaving no partial objects behind.
    /// </summary>
    [Fact]
    public async Task ApplyingMigrationThatFailsMidWay_SurfacesErrorAndLeavesNoPartialSchema()
    {
        await WithFreshDatabaseAsync(async connectionString =>
        {
            await using var context = new FailingMigrationsDbContext(
                MigrationTestSupport.BuildContextOptions<FailingMigrationsDbContext>(connectionString));

            // The failing migration surfaces an error (Req 11.6).
            await Assert.ThrowsAnyAsync<Exception>(() => context.Database.MigrateAsync());

            // The table the failed migration began creating was rolled back — no partial schema (Req 11.6).
            Assert.False(await MigrationTestSupport.TableExistsAsync(
                connectionString, "public", CreateFailingTwo.PartialTableName));
        });
    }

    /// <summary>
    /// Creates a production <see cref="PitchMateDbContext"/> bound to the throwaway database, using
    /// deterministic fakes for the clock and actor (audit stamping is irrelevant to migration tests
    /// but the constructor requires them).
    /// </summary>
    private static PitchMateDbContext CreateContext(string connectionString) =>
        new(
            MigrationTestSupport.BuildContextOptions(connectionString),
            new FakeTimeProvider(),
            new FakeCurrentUserAccessor());

    /// <summary>
    /// Asserts that the migrated <c>public</c> schema contains exactly the model's tables (nothing
    /// stray), and that every model-defined primary key, foreign key, and index exists in
    /// PostgreSQL's catalog. With no concrete entities mapped today this confirms the empty initial
    /// migration created no unexpected tables; it scales to assert real objects as entities arrive.
    /// </summary>
    private static async Task AssertSchemaMatchesModelAsync(PitchMateDbContext context, string connectionString)
    {
        var expectedTables = context.Model.GetEntityTypes()
            .Select(entityType => entityType.GetTableName())
            .Where(name => name is not null)
            .Select(name => name!)
            .Distinct()
            .OrderBy(name => name, StringComparer.Ordinal)
            .ToList();

        var actualTables = (await MigrationTestSupport.ListModelTablesAsync(connectionString))
            .OrderBy(name => name, StringComparer.Ordinal)
            .ToList();

        Assert.Equal(expectedTables, actualTables);

        foreach (var entityType in context.Model.GetEntityTypes())
        {
            var primaryKey = entityType.FindPrimaryKey();
            if (primaryKey is not null)
            {
                Assert.True(
                    await MigrationTestSupport.ConstraintExistsAsync(connectionString, primaryKey.GetName()!),
                    $"Expected primary key '{primaryKey.GetName()}' to exist.");
            }

            foreach (var foreignKey in entityType.GetForeignKeys())
            {
                var name = foreignKey.GetConstraintName();
                if (name is not null)
                {
                    Assert.True(
                        await MigrationTestSupport.ConstraintExistsAsync(connectionString, name),
                        $"Expected foreign key '{name}' to exist.");
                }
            }

            foreach (var index in entityType.GetIndexes())
            {
                Assert.True(
                    await MigrationTestSupport.IndexExistsAsync(connectionString, index.GetDatabaseName()!),
                    $"Expected index '{index.GetDatabaseName()}' to exist.");
            }
        }
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
