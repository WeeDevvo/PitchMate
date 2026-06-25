using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using PitchMate.Infrastructure;
using PitchMate.Infrastructure.Persistence;
using Testcontainers.PostgreSql;

namespace PitchMate.Infrastructure.Tests.Persistence;

/// <summary>
/// End-to-end smoke test for the startup half of the migration-execution policy (task 7.4):
/// when the application starts in the <c>Production</c> environment against a database with a
/// pending migration, it starts successfully and does <em>not</em> apply the migration — the
/// database schema is left unchanged (Req 12.2). The startup path under test is the exact
/// production wiring (<see cref="DependencyInjection.AddInfrastructure"/>) built and validated the
/// way <c>PitchMate.Api</c>'s <c>Program.cs</c> builds its host (<c>ValidateOnBuild</c> +
/// <c>ValidateScopes</c>); that path contains no <c>Migrate()</c>/<c>EnsureCreated()</c> call, which
/// <see cref="MigrationPolicySmokeTests"/> verifies structurally.
/// <para>
/// This test owns a <em>dedicated, empty</em> PostgreSQL container (a real database — never the EF
/// in-memory provider or SQLite) so it stays isolated from the shared persistence fixture and from
/// the concurrent migration integration tests (task 7.3). An empty database has the initial
/// migration pending and no <c>__EFMigrationsHistory</c> table, which is precisely the
/// "pending migration" precondition the policy must tolerate without migrating. Running it requires
/// Docker locally and in CI.
/// </para>
/// <para>Validates: Requirements 12.1, 12.2.</para>
/// </summary>
public sealed class MigrationStartupPolicySmokeTests : IAsyncLifetime
{
    private const string PostgreSqlImage = "postgres:17.2";
    private const string InitialMigrationId = "20260625201240_InitialCreate";

    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder(PostgreSqlImage)
        .WithDatabase("pitchmate_migration_policy")
        .WithUsername("pitchmate")
        .WithPassword("pitchmate")
        .Build();

    /// <summary>Starts the dedicated, empty container.</summary>
    public Task InitializeAsync() => _container.StartAsync();

    /// <summary>Stops and disposes the dedicated container.</summary>
    public async Task DisposeAsync() => await _container.DisposeAsync();

    // Requirement 12.2 — production startup tolerates a pending migration and applies nothing.
    /// <summary>
    /// With the initial migration pending on an empty database, building the production host (in the
    /// Production environment, with DI validation enabled) succeeds, and afterwards the migration is
    /// still pending, none is recorded as applied, and the set of database tables is unchanged.
    /// </summary>
    [Fact]
    public async Task AppStartsInProductionWithPendingMigrationWithoutAlteringTheDatabase()
    {
        // Precondition: the empty database has the initial migration pending and no schema yet.
        IReadOnlyList<string> pendingBefore;
        IReadOnlyList<string> appliedBefore;
        HashSet<string> tablesBefore;
        await using (var probe = CreateProbeContext())
        {
            pendingBefore = (await probe.Database.GetPendingMigrationsAsync()).ToList();
            appliedBefore = (await probe.Database.GetAppliedMigrationsAsync()).ToList();
            tablesBefore = await GetPublicTableNamesAsync(probe);
        }

        Assert.Contains(InitialMigrationId, pendingBefore);
        Assert.Empty(appliedBefore);

        // Act: start the app exactly as production does — build the host with the production wiring,
        // in the Production environment, validating the container on build. No code path migrates.
        using var provider = BuildProductionStartupProvider();
        using (var scope = provider.CreateScope())
        {
            // Resolving the context is what a request does at runtime; it must not trigger a migration.
            _ = scope.ServiceProvider.GetRequiredService<PitchMateDbContext>();
        }

        // Assert: the migration is still pending, nothing was applied, and the schema is untouched.
        await using var verify = CreateProbeContext();
        var pendingAfter = (await verify.Database.GetPendingMigrationsAsync()).ToList();
        var appliedAfter = (await verify.Database.GetAppliedMigrationsAsync()).ToList();
        var tablesAfter = await GetPublicTableNamesAsync(verify);

        Assert.Contains(InitialMigrationId, pendingAfter);
        Assert.Empty(appliedAfter);
        Assert.DoesNotContain("__EFMigrationsHistory", tablesAfter);
        Assert.Equal(tablesBefore, tablesAfter);
    }

    /// <summary>
    /// Builds the production service provider via <see cref="DependencyInjection.AddInfrastructure"/>,
    /// pointed at the dedicated container and marked as the Production environment, then validates it on
    /// build (and validates scopes) the way <c>Program.cs</c> configures its host. A throw here would be
    /// a startup failure; success demonstrates the app starts despite the pending migration.
    /// </summary>
    private ServiceProvider BuildProductionStartupProvider()
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                // Marks the production environment for intent; the startup path applies no migration
                // regardless of environment, which this provider build and the post-conditions confirm.
                ["ASPNETCORE_ENVIRONMENT"] = "Production",
                ["ConnectionStrings:Default"] = _container.GetConnectionString(),
            })
            .Build();

        var services = new ServiceCollection();
        services.AddInfrastructure(configuration);

        return services.BuildServiceProvider(new ServiceProviderOptions
        {
            ValidateOnBuild = true,
            ValidateScopes = true,
        });
    }

    /// <summary>
    /// Creates a context bound to the dedicated container for inspecting migration and schema state,
    /// using the same Npgsql + snake_case options the production registration uses.
    /// </summary>
    private PitchMateDbContext CreateProbeContext()
    {
        var options = new DbContextOptionsBuilder<PitchMateDbContext>()
            .UseNpgsql(_container.GetConnectionString())
            .UseSnakeCaseNamingConvention()
            .Options;

        return new PitchMateDbContext(options, TimeProvider.System, new FakeCurrentUserAccessor());
    }

    /// <summary>
    /// Reads the names of all tables in the <c>public</c> schema directly over the underlying
    /// connection, so the "schema unchanged" assertion is independent of EF's model.
    /// </summary>
    private static async Task<HashSet<string>> GetPublicTableNamesAsync(PitchMateDbContext context)
    {
        var connection = context.Database.GetDbConnection();
        await connection.OpenAsync();
        try
        {
            await using var command = connection.CreateCommand();
            command.CommandText =
                "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'";

            var tables = new HashSet<string>(StringComparer.Ordinal);
            await using var reader = await command.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                tables.Add(reader.GetString(0));
            }

            return tables;
        }
        finally
        {
            await connection.CloseAsync();
        }
    }
}
