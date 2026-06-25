using Microsoft.EntityFrameworkCore;
using PitchMate.Application.Common;
using PitchMate.Infrastructure.Persistence;
using Testcontainers.PostgreSql;

namespace PitchMate.Infrastructure.Tests.Persistence;

/// <summary>
/// Shared xUnit fixture that starts a real PostgreSQL instance in a throwaway container
/// (Testcontainers) once for the whole test collection and creates the schema for the
/// persistence harness's test entities against it.
/// <para>
/// This is deliberately a <em>real</em> PostgreSQL provider — never the EF in-memory provider
/// or SQLite — so the property and integration tests in tasks 5.2–5.8 exercise actual
/// PostgreSQL constraint, transaction, concurrency, and <c>uuid</c>/<c>timestamptz</c>
/// behaviour. Running these tests therefore requires Docker to be available locally and in CI.
/// </para>
/// <para>
/// Each test creates its own <see cref="PersistenceTestDbContext"/> via
/// <see cref="CreateContext"/> with its own controllable clock and actor, so tests stay
/// deterministic and isolated from one another while sharing the single container.
/// </para>
/// </summary>
public sealed class PostgreSqlContainerFixture : IAsyncLifetime
{
    // Pinned image version (steering: pin dependency versions).
    private const string PostgreSqlImage = "postgres:17.2";

    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder(PostgreSqlImage)
        .WithDatabase("pitchmate_tests")
        .WithUsername("pitchmate")
        .WithPassword("pitchmate")
        .Build();

    /// <summary>The connection string for the running container, valid after <see cref="InitializeAsync"/>.</summary>
    public string ConnectionString => _container.GetConnectionString();

    /// <summary>
    /// Builds context options targeting the running container, applying the same Npgsql +
    /// snake_case naming convention the production registration uses, so mapping behaviour
    /// under test matches production.
    /// </summary>
    public DbContextOptions<PitchMateDbContext> CreateOptions() =>
        new DbContextOptionsBuilder<PitchMateDbContext>()
            .UseNpgsql(ConnectionString)
            .UseSnakeCaseNamingConvention()
            .Options;

    /// <summary>
    /// Creates a fresh <see cref="PersistenceTestDbContext"/> bound to the container, using the
    /// supplied controllable clock and actor accessor for deterministic audit stamping.
    /// </summary>
    /// <param name="clock">The time abstraction the context stamps audit timestamps from.</param>
    /// <param name="currentUser">The accessor supplying the acting user for audit metadata.</param>
    public PersistenceTestDbContext CreateContext(TimeProvider clock, ICurrentUserAccessor currentUser) =>
        new(CreateOptions(), clock, currentUser);

    /// <summary>
    /// Creates a fresh context with default fakes (a fixed clock and no current user), for tests
    /// that do not need to control time or actor themselves.
    /// </summary>
    public PersistenceTestDbContext CreateContext() =>
        CreateContext(new FakeTimeProvider(), new FakeCurrentUserAccessor());

    /// <summary>
    /// Starts the container and creates the test-entity schema against the real database.
    /// </summary>
    public async Task InitializeAsync()
    {
        await _container.StartAsync();

        // Create the schema for the test entities from the model against real PostgreSQL.
        // The persistence-foundation's own migration is validated separately (tasks 5.7/7.3);
        // the test entities are test-only and intentionally not part of any migration.
        await using var context = CreateContext();
        await context.Database.EnsureCreatedAsync();
    }

    /// <summary>Stops and disposes the container.</summary>
    public async Task DisposeAsync()
    {
        await _container.DisposeAsync();
    }
}
