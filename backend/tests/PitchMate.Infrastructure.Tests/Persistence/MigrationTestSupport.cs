using Microsoft.EntityFrameworkCore;
using Npgsql;
using PitchMate.Infrastructure.Persistence;

namespace PitchMate.Infrastructure.Tests.Persistence;

/// <summary>
/// Helpers for the migration integration tests. Each migration test needs its own
/// <em>empty</em> PostgreSQL database so it can apply the initial migration (or a test-only
/// migration set) to a clean baseline and observe the resulting schema. Rather than start a
/// second container, these helpers create a uniquely-named throwaway database on the shared
/// Testcontainers PostgreSQL server (the same real database server the rest of the persistence
/// suite uses — never an in-memory or SQLite substitute), build EF Core options targeting it,
/// and drop it afterwards.
/// <para>
/// Per-test connections disable pooling so the database can be dropped immediately after the
/// test without lingering pooled connections blocking the <c>DROP DATABASE</c>.
/// </para>
/// </summary>
internal static class MigrationTestSupport
{
    /// <summary>The EF Core migrations-history table name (fixed by the provider, not the naming convention).</summary>
    public const string HistoryTableName = "__EFMigrationsHistory";

    /// <summary>
    /// Derives a connection string targeting <paramref name="databaseName"/> on the same server as
    /// <paramref name="baseConnectionString"/>, with connection pooling disabled so the database can
    /// be dropped cleanly at the end of a test.
    /// </summary>
    public static string ConnectionStringForDatabase(string baseConnectionString, string databaseName) =>
        new NpgsqlConnectionStringBuilder(baseConnectionString)
        {
            Database = databaseName,
            Pooling = false,
        }.ConnectionString;

    /// <summary>
    /// Builds EF Core options for the production <see cref="PitchMateDbContext"/> targeting the
    /// supplied connection string, applying the same Npgsql + snake_case naming convention the
    /// production registration and design-time factory use, so the applied migration reflects the
    /// real mapping conventions.
    /// </summary>
    public static DbContextOptions<PitchMateDbContext> BuildContextOptions(string connectionString) =>
        new DbContextOptionsBuilder<PitchMateDbContext>()
            .UseNpgsql(connectionString)
            .UseSnakeCaseNamingConvention()
            .Options;

    /// <summary>
    /// Builds EF Core options for a test-only migrations context targeting the supplied connection
    /// string. These contexts use raw-SQL migrations and need no naming convention.
    /// </summary>
    public static DbContextOptions<TContext> BuildContextOptions<TContext>(string connectionString)
        where TContext : DbContext =>
        new DbContextOptionsBuilder<TContext>()
            .UseNpgsql(connectionString)
            .Options;

    /// <summary>Creates a fresh, empty database on the server identified by the base connection string.</summary>
    public static async Task CreateDatabaseAsync(string baseConnectionString, string databaseName)
    {
        await using var connection = OpenMaintenanceConnection(baseConnectionString);
        await connection.OpenAsync();

        await using var command = connection.CreateCommand();
        command.CommandText = $"CREATE DATABASE \"{databaseName}\";";
        await command.ExecuteNonQueryAsync();
    }

    /// <summary>Drops the throwaway database, forcibly terminating any lingering connections to it.</summary>
    public static async Task DropDatabaseAsync(string baseConnectionString, string databaseName)
    {
        await using var connection = OpenMaintenanceConnection(baseConnectionString);
        await connection.OpenAsync();

        await using var command = connection.CreateCommand();
        // WITH (FORCE) (PostgreSQL 13+) disconnects any remaining sessions so the drop succeeds.
        command.CommandText = $"DROP DATABASE IF EXISTS \"{databaseName}\" WITH (FORCE);";
        await command.ExecuteNonQueryAsync();
    }

    /// <summary>Returns the names of all base tables in the <c>public</c> schema of the target database.</summary>
    public static async Task<List<string>> ListPublicTablesAsync(string connectionString)
    {
        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync();

        await using var command = connection.CreateCommand();
        command.CommandText =
            "SELECT table_name FROM information_schema.tables " +
            "WHERE table_schema = 'public' AND table_type = 'BASE TABLE';";

        var tables = new List<string>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            tables.Add(reader.GetString(0));
        }

        return tables;
    }

    /// <summary>Returns the names of all base tables in <c>public</c> excluding the migrations-history table.</summary>
    public static async Task<List<string>> ListModelTablesAsync(string connectionString)
    {
        var tables = await ListPublicTablesAsync(connectionString);
        tables.RemoveAll(t => t == HistoryTableName);
        return tables;
    }

    /// <summary>Reports whether a base table with the given name exists in the given schema.</summary>
    public static async Task<bool> TableExistsAsync(string connectionString, string schema, string table)
    {
        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync();

        await using var command = connection.CreateCommand();
        command.CommandText =
            "SELECT EXISTS (SELECT 1 FROM information_schema.tables " +
            "WHERE table_schema = @schema AND table_name = @table);";
        command.Parameters.AddWithValue("schema", schema);
        command.Parameters.AddWithValue("table", table);

        return (bool)(await command.ExecuteScalarAsync())!;
    }

    /// <summary>Reports whether a named constraint (primary key, foreign key, …) exists.</summary>
    public static async Task<bool> ConstraintExistsAsync(string connectionString, string constraintName)
    {
        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync();

        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = @name);";
        command.Parameters.AddWithValue("name", constraintName);

        return (bool)(await command.ExecuteScalarAsync())!;
    }

    /// <summary>Reports whether a named index exists.</summary>
    public static async Task<bool> IndexExistsAsync(string connectionString, string indexName)
    {
        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync();

        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT EXISTS (SELECT 1 FROM pg_class WHERE relkind = 'i' AND relname = @name);";
        command.Parameters.AddWithValue("name", indexName);

        return (bool)(await command.ExecuteScalarAsync())!;
    }

    private static NpgsqlConnection OpenMaintenanceConnection(string baseConnectionString)
    {
        // Connect to the always-present "postgres" maintenance database so we can create/drop the
        // throwaway test database. Pooling is disabled so these short-lived admin connections close
        // promptly and never block a subsequent DROP.
        var maintenance = new NpgsqlConnectionStringBuilder(baseConnectionString)
        {
            Database = "postgres",
            Pooling = false,
        }.ConnectionString;

        return new NpgsqlConnection(maintenance);
    }
}
