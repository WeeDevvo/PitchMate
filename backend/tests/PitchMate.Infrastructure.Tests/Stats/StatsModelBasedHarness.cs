using Microsoft.EntityFrameworkCore;
using PitchMate.Application.Stats;
using PitchMate.Domain.Rating;
using PitchMate.Infrastructure;
using PitchMate.Infrastructure.Persistence;
using PitchMate.Infrastructure.Stats;
using PitchMate.Infrastructure.Tests.Persistence;
using DisplayRatingParameters = PitchMate.Domain.Stats.DisplayRatingParameters;

namespace PitchMate.Infrastructure.Tests.Stats;

/// <summary>
/// Shared harness for the model-based stats property/integration tests (tasks 6.2–6.11). Built on the
/// shared <see cref="PostgreSqlContainerFixture"/>, it creates a fresh, migrated throwaway database on
/// the shared server, seeds a generated <see cref="StatsDatasetSpec"/> into it via
/// <see cref="StatsDatasetSeeder"/>, and hands the test a real <see cref="EfStatsRepository"/> (reading
/// from its own context so no change-tracker state leaks) alongside the resolved
/// <see cref="SeededStatsDataset"/> the <see cref="StatsReferenceOracle"/> computes over — then drops
/// the database. The <see cref="RatingEngine"/> and <see cref="DisplayParameters"/> the repository is
/// constructed with are exposed so the oracle classifies display ratings identically.
/// </summary>
public sealed class StatsModelBasedHarness
{
    private readonly PostgreSqlContainerFixture _fixture;
    private readonly StatsDatasetSeeder _seeder = new();

    /// <summary>Creates the harness over the shared container fixture.</summary>
    /// <param name="fixture">The shared, container-backed persistence fixture.</param>
    public StatsModelBasedHarness(PostgreSqlContainerFixture fixture)
    {
        ArgumentNullException.ThrowIfNull(fixture);
        _fixture = fixture;
    }

    /// <summary>The rating engine the repository (and the oracle) use to classify display-rating state.</summary>
    public IRatingEngine RatingEngine { get; } = new PlackettLuceRatingEngine(new RatingEngineConfig());

    /// <summary>The display-rating parameters the MVP source returns for every squad (the defaults).</summary>
    public DisplayRatingParameters DisplayParameters { get; } = DisplayRatingParameters.Default;

    /// <summary>
    /// Seeds <paramref name="spec"/> into a fresh migrated database and invokes <paramref name="body"/>
    /// with a real <see cref="IStatsRepository"/> reading it and the resolved dataset, dropping the
    /// database afterwards regardless of outcome.
    /// </summary>
    /// <param name="spec">The dataset to seed and read back.</param>
    /// <param name="body">The test body comparing the repository against the reference oracle.</param>
    public async Task WithSeededDatasetAsync(
        StatsDatasetSpec spec,
        Func<IStatsRepository, SeededStatsDataset, Task> body)
    {
        ArgumentNullException.ThrowIfNull(spec);
        ArgumentNullException.ThrowIfNull(body);

        var databaseName = "stats_" + Guid.NewGuid().ToString("N");
        await MigrationTestSupport.CreateDatabaseAsync(_fixture.ConnectionString, databaseName);

        try
        {
            var connectionString =
                MigrationTestSupport.ConnectionStringForDatabase(_fixture.ConnectionString, databaseName);

            await using (var schema = CreateContext(connectionString))
            {
                await schema.Database.MigrateAsync();
            }

            SeededStatsDataset seeded;
            await using (var write = CreateContext(connectionString))
            {
                seeded = await _seeder.SeedAsync(write, spec, new FakeTimeProvider(), CancellationToken.None);
            }

            await using (var read = CreateContext(connectionString))
            {
                var repository = new EfStatsRepository(read, RatingEngine, new SquadDisplayRatingParametersSource());
                await body(repository, seeded);
            }
        }
        finally
        {
            await MigrationTestSupport.DropDatabaseAsync(_fixture.ConnectionString, databaseName);
        }
    }

    /// <summary>Creates a production <see cref="PitchMateDbContext"/> bound to the throwaway database.</summary>
    private static PitchMateDbContext CreateContext(string connectionString) =>
        new(
            MigrationTestSupport.BuildContextOptions(connectionString),
            new FakeTimeProvider(),
            new FakeCurrentUserAccessor());
}
