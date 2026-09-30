using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using Npgsql;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Matches;
using PitchMate.Infrastructure.Persistence;
using PitchMate.Infrastructure.Stats;
using PitchMate.Infrastructure.Tests.Persistence;

namespace PitchMate.Infrastructure.Tests.Stats;

/// <summary>
/// Harness for the membership-standing scope property test (api-response-contracts Property 20,
/// task 6.2). It runs the real <see cref="EfMembershipStandingSource"/> SQL against real PostgreSQL on
/// the shared <see cref="PostgreSqlContainerFixture"/> container, with the production EF migrations
/// applied — never an in-memory or SQLite substitute.
/// <para>
/// <b>One database per test class, not per generated case.</b> Unlike
/// <see cref="StatsModelBasedHarness"/>, which creates, migrates and drops a throwaway database for
/// every FsCheck case, this harness creates and migrates <em>one</em> database on first use and seeds
/// each generated case into it as a fresh pair of squads with fresh identities. Two reasons: creating a
/// database per case opens a new connection pool per case
/// (the migration helpers also disable pooling), which on Windows exhausts the ephemeral port range
/// and produces spurious <c>Failed to connect</c> / <c>WSAEADDRINUSE</c> failures unrelated to any
/// assertion; and accumulating earlier cases' squads in the same database strengthens the property,
/// because every previous case's squad is another squad whose completed matches must not contribute.
/// Connection pooling is left enabled here precisely so sockets are reused across cases.
/// </para>
/// </summary>
internal sealed class MembershipStandingScopeHarness
{
    /// <summary>
    /// The fixed name of the harness's database. It is deliberately not per-run: FsCheck's xUnit runner
    /// does not honour <c>IAsyncLifetime</c>, so there is no hook that could reliably drop a
    /// uniquely-named database at the end of the property. A fixed name is self-healing instead — the
    /// harness drops any leftover from a previous run before recreating it — and at most one spare
    /// database ever exists inside a container that is thrown away with the test collection.
    /// </summary>
    private const string DatabaseName = "standing_scope";

    private readonly PostgreSqlContainerFixture _fixture;
    private readonly StatsDatasetSeeder _seeder = new();
    private readonly SemaphoreSlim _gate = new(1, 1);
    private string _connectionString = string.Empty;
    private bool _ready;

    /// <summary>Creates the harness over the shared PostgreSQL container fixture.</summary>
    /// <param name="fixture">The shared, container-backed persistence fixture.</param>
    public MembershipStandingScopeHarness(PostgreSqlContainerFixture fixture)
    {
        ArgumentNullException.ThrowIfNull(fixture);
        _fixture = fixture;
    }

    /// <summary>
    /// Seeds one generated dataset into the harness's database through the production aggregates and
    /// repositories, returning the resolved, identity-bearing model of exactly what was persisted.
    /// </summary>
    /// <param name="spec">The generated dataset to materialise.</param>
    public async Task<SeededStatsDataset> SeedAsync(StatsDatasetSpec spec)
    {
        ArgumentNullException.ThrowIfNull(spec);
        await EnsureDatabaseAsync();

        await using var write = CreateContext();
        return await _seeder.SeedAsync(write, spec, new FakeTimeProvider(), CancellationToken.None);
    }

    /// <summary>
    /// Runs the real standing source over a fresh context, so no change-tracker state from seeding can
    /// satisfy the read and the answer comes from SQL alone.
    /// </summary>
    /// <param name="squadId">The squad to read standing for.</param>
    public async Task<IReadOnlyDictionary<Guid, MembershipStanding>> ListForSquadAsync(Guid squadId)
    {
        await EnsureDatabaseAsync();

        await using var read = CreateContext();
        var source = new EfMembershipStandingSource(read);
        return await source.ListForSquadAsync(squadId, CancellationToken.None);
    }

    /// <summary>
    /// Appends a membership identity to a persisted team's roster array with a direct <c>UPDATE</c>.
    /// <para>
    /// This is the property's <b>negative control</b> for squad scoping, and it deliberately bypasses
    /// the <see cref="Match"/> aggregate. Because the domain only ever admits a squad's own members to
    /// its own matches, two squads' rosters are otherwise disjoint by construction — which would make
    /// the "completed matches of the requested squad <em>alone</em>" clause untestable, since dropping
    /// the squad filter from the query could not change any count. Planting one squad's membership in
    /// another squad's completed lineup makes that clause load-bearing: only a genuinely squad-scoped
    /// count still reports the right number.
    /// </para>
    /// <para>
    /// The table and column names are read from the EF model rather than hard-coded, so the statement
    /// follows the mapping configuration and the snake_case convention wherever they move.
    /// </para>
    /// </summary>
    /// <param name="teamId">The persisted match team whose roster is extended.</param>
    /// <param name="membershipId">The membership identity to plant in that roster.</param>
    public async Task AppendToTeamRosterAsync(Guid teamId, Guid membershipId)
    {
        await EnsureDatabaseAsync();

        await using var context = CreateContext();

        IEntityType team = context.Model.FindEntityType(typeof(MatchTeam))
            ?? throw new InvalidOperationException("MatchTeam is not mapped.");
        string table = team.GetTableName()
            ?? throw new InvalidOperationException("MatchTeam has no table name.");
        var store = StoreObjectIdentifier.Table(table, team.GetSchema());
        string roster = ColumnName(team, nameof(MatchTeam.Roster), store);
        string key = ColumnName(team, nameof(MatchTeam.Id), store);

        // {0} / {1} are EF's positional placeholders; they are sent as typed parameters, never inlined.
        var sql =
            $"UPDATE \"{table}\" SET \"{roster}\" = \"{roster}\" || CAST({{0}} AS uuid) WHERE \"{key}\" = {{1}}";

        int affected = await context.Database.ExecuteSqlRawAsync(sql, membershipId, teamId);
        if (affected != 1)
        {
            throw new InvalidOperationException(
                $"Expected to extend exactly one roster for team {teamId}, but {affected} rows were updated. " +
                "The cross-squad negative control did not take effect, so the squad-scoping assertion would be vacuous.");
        }
    }

    /// <summary>
    /// Creates the harness's database and applies the production EF migrations to it, once, on first
    /// use. Initialisation is lazy rather than in a lifecycle hook because FsCheck's xUnit runner does
    /// not call <c>IAsyncLifetime</c> on the test class, and it is idempotent and gated so every later
    /// generated case reuses the same migrated database (and its connection pool).
    /// </summary>
    private async Task EnsureDatabaseAsync()
    {
        if (_ready)
        {
            return;
        }

        await _gate.WaitAsync();
        try
        {
            if (_ready)
            {
                return;
            }

            // Drop first: a previous run of this class had no hook in which to clean up.
            await MigrationTestSupport.DropDatabaseAsync(_fixture.ConnectionString, DatabaseName);
            await MigrationTestSupport.CreateDatabaseAsync(_fixture.ConnectionString, DatabaseName);
            _connectionString = PooledConnectionString(DatabaseName);

            await using var schema = CreateContext();
            await schema.Database.MigrateAsync();

            _ready = true;
        }
        finally
        {
            _gate.Release();
        }
    }

    private static string ColumnName(IEntityType entity, string propertyName, StoreObjectIdentifier store) =>
        entity.FindProperty(propertyName)?.GetColumnName(store)
        ?? throw new InvalidOperationException($"MatchTeam.{propertyName} is not mapped to a column.");

    /// <summary>Creates a production context bound to the class's database.</summary>
    private PitchMateDbContext CreateContext() =>
        new(
            MigrationTestSupport.BuildContextOptions(_connectionString),
            new FakeTimeProvider(),
            new FakeCurrentUserAccessor());

    /// <summary>
    /// The connection string for the class's database with pooling left <em>enabled</em>, so the many
    /// short-lived contexts across generated cases reuse sockets instead of opening a new one each time.
    /// </summary>
    private string PooledConnectionString(string databaseName) =>
        new NpgsqlConnectionStringBuilder(_fixture.ConnectionString)
        {
            Database = databaseName,
        }.ConnectionString;
}
