using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Npgsql;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Domain.Matches;
using PitchMate.Domain.Squads;
using PitchMate.Infrastructure.Matches.Queries;
using PitchMate.Infrastructure.Persistence;
using PitchMate.Infrastructure.Tests.Persistence;

namespace PitchMate.Infrastructure.Tests.Matches;

/// <summary>
/// Harness for the <see cref="EfMatchListSource"/> integration tests (match-read-models task 5.3). It
/// runs the production query source's real SQL against real PostgreSQL on the shared
/// <see cref="PostgreSqlContainerFixture"/> container with the <b>production EF migrations applied</b>
/// — never the EF in-memory provider and never SQLite, both of which would hide exactly the
/// behaviours this read depends on: <c>jsonb_array_elements</c>, <c>LEFT JOIN LATERAL</c>,
/// <c>NULLS LAST</c> and <c>uuid</c> byte ordering.
/// <para>
/// <b>One database per test class, created lazily, with a fixed self-healing name.</b> This follows
/// <c>MembershipStandingScopeHarness</c>'s precedent rather than the per-case-database pattern:
/// creating a database per case opens a new connection pool per case, which on Windows exhausted the
/// ephemeral port range and produced spurious <c>WSAEADDRINUSE</c> failures unrelated to any
/// assertion. Connection pooling is therefore left <b>enabled</b> in every connection string built
/// here, and the database name is fixed rather than per-run — initialisation drops any leftover from
/// a previous run with <c>WITH (FORCE)</c> before recreating it, which is self-healing without
/// needing a teardown hook.
/// </para>
/// <para>
/// Each seeded dataset lands in that one database as fresh squads with fresh identities, so every
/// earlier test's squad stays behind as another squad whose matches must not contribute — which
/// strengthens the squad-scoping assertions rather than weakening them.
/// </para>
/// </summary>
internal sealed class MatchListSourceHarness
{
    /// <summary>
    /// The default fixed name of the harness's database. Deliberately not per-run: a fixed name is
    /// self-healing (dropped and recreated on first use) and at most one spare database ever exists
    /// inside a container that is thrown away with the test collection.
    /// </summary>
    private const string DefaultDatabaseName = "match_list_source";

    private readonly PostgreSqlContainerFixture _fixture;
    private readonly string _databaseName;
    private readonly MatchListDatasetSeeder _seeder = new();
    private readonly SemaphoreSlim _gate = new(1, 1);
    private string _connectionString = string.Empty;
    private bool _ready;

    /// <summary>Creates the harness over the shared PostgreSQL container fixture.</summary>
    /// <param name="fixture">The shared, container-backed persistence fixture.</param>
    /// <param name="databaseName">
    /// The fixed name of the database this harness owns. Each test class that builds a harness passes
    /// its <em>own</em> name, because the mandated shape is one migrated database per test class: two
    /// classes sharing one name would have the second class's lazy initialisation drop the first
    /// class's database out from under it.
    /// </param>
    public MatchListSourceHarness(PostgreSqlContainerFixture fixture, string databaseName = DefaultDatabaseName)
    {
        ArgumentNullException.ThrowIfNull(fixture);
        ArgumentException.ThrowIfNullOrWhiteSpace(databaseName);
        _fixture = fixture;
        _databaseName = databaseName;
    }

    /// <summary>
    /// The instant every seeded candidate day is offset from. Candidate days must be strictly future
    /// relative to it, which <see cref="MatchListDatasetSpec.MatchSpec.CandidateDayOffsetDays"/>
    /// guarantees by using strictly-positive offsets.
    /// </summary>
    public static DateTimeOffset Anchor => FakeTimeProvider.DefaultNow;

    /// <summary>
    /// Seeds one dataset into the harness's database and applies the spec's soft-deletions, returning
    /// the resolved model.
    /// <para>
    /// The soft-deletions run as a <em>second</em> unit of work, so the production save pipeline
    /// reinterprets the removal of an already-persisted row — the same path a real deletion takes —
    /// rather than of a row added in the same <c>SaveChanges</c>.
    /// </para>
    /// </summary>
    /// <param name="spec">The dataset to materialise.</param>
    public async Task<SeededMatchListDataset> SeedAsync(MatchListDatasetSpec spec)
    {
        ArgumentNullException.ThrowIfNull(spec);
        await EnsureDatabaseAsync();

        SeededMatchListDataset seeded;
        await using (PitchMateDbContext write = CreateContext())
        {
            seeded = await _seeder.SeedAsync(write, spec, Anchor, CancellationToken.None);
        }

        foreach (SeededMatchListDataset.SquadData squad in seeded.Squads)
        {
            foreach (Guid matchId in squad.SoftDeletedMatchIds)
            {
                await SoftDeleteAsync<Match>(matchId);
            }

            if (squad.IsSoftDeleted)
            {
                await SoftDeleteAsync<Squad>(squad.SquadId);
            }
        }

        return seeded;
    }

    /// <summary>
    /// Convenience overload seeding a single squad.
    /// </summary>
    /// <param name="squad">The squad spec to materialise.</param>
    public async Task<SeededMatchListDataset.SquadData> SeedSquadAsync(MatchListDatasetSpec.SquadSpec squad)
    {
        SeededMatchListDataset seeded = await SeedAsync(new MatchListDatasetSpec([squad]));
        return seeded.SquadAt(0);
    }

    /// <summary>
    /// Runs the real <see cref="EfMatchListSource"/> over a <em>fresh</em> context, so no
    /// change-tracker state from seeding can satisfy the read and the answer comes from the SQL alone.
    /// </summary>
    /// <param name="squadId">The squad to list matches for.</param>
    /// <param name="limit">The caller's entry limit.</param>
    public async Task<MatchListPage?> ListForSquadAsync(Guid squadId, int limit)
    {
        await EnsureDatabaseAsync();

        await using PitchMateDbContext read = CreateContext();
        var source = new EfMatchListSource(read);
        return await source.ListForSquadAsync(squadId, limit, CancellationToken.None);
    }

    /// <summary>
    /// Runs the real <see cref="EfMatchListSource"/> exactly as <see cref="ListForSquadAsync"/> does,
    /// but over a context carrying a <see cref="CommandCountingInterceptor"/>, so the caller can
    /// assert over what the provider actually executed — both the number of commands and their text.
    /// <para>
    /// A <em>fresh</em> interceptor is created per call and registered on that call's context options
    /// alone, so nothing is shared between reads and the uninstrumented
    /// <see cref="ListForSquadAsync"/> path the task 5.3 tests use is untouched.
    /// </para>
    /// </summary>
    /// <param name="squadId">The squad to list matches for.</param>
    /// <param name="limit">The caller's entry limit.</param>
    /// <returns>The page the source produced, and the commands that produced it.</returns>
    public async Task<(MatchListPage? Page, CommandCountingInterceptor Commands)> ListForSquadCapturingCommandsAsync(
        Guid squadId,
        int limit)
    {
        await EnsureDatabaseAsync();

        var commands = new CommandCountingInterceptor();
        await using PitchMateDbContext read = CreateContext(commands);
        var source = new EfMatchListSource(read);
        MatchListPage? page = await source.ListForSquadAsync(squadId, limit, CancellationToken.None);

        return (page, commands);
    }

    /// <summary>
    /// Soft-deletes one persisted row through the production save pipeline, which reinterprets an EF
    /// delete on a soft-deletable entity as a soft-delete rather than removing the row.
    /// </summary>
    private async Task SoftDeleteAsync<TEntity>(Guid id)
        where TEntity : PitchMate.Domain.Common.BaseEntity
    {
        await using PitchMateDbContext context = CreateContext();

        TEntity entity = await context.Set<TEntity>().FirstAsync(row => row.Id == id);
        context.Set<TEntity>().Remove(entity);
        await context.SaveChangesAsync();
    }

    /// <summary>
    /// Creates the harness's database and applies the production EF migrations to it, once, on first
    /// use. Initialisation is lazy and gated rather than in a lifecycle hook so every later test in
    /// the class reuses the same migrated database — and its connection pool.
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

            // Drop first: a previous run of this class may have left the fixed-name database behind.
            await MigrationTestSupport.DropDatabaseAsync(_fixture.ConnectionString, _databaseName);
            await MigrationTestSupport.CreateDatabaseAsync(_fixture.ConnectionString, _databaseName);
            _connectionString = PooledConnectionString(_databaseName);

            await using PitchMateDbContext schema = CreateContext();
            await schema.Database.MigrateAsync();

            _ready = true;
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>
    /// Creates a production context bound to the class's database, optionally carrying interceptors.
    /// With no interceptor the options are byte-for-byte what every existing caller built.
    /// </summary>
    private PitchMateDbContext CreateContext(params IInterceptor[] interceptors) =>
        new(
            MigrationTestSupport.BuildContextOptions(_connectionString, interceptors),
            new FakeTimeProvider(),
            new FakeCurrentUserAccessor());

    /// <summary>
    /// The connection string for the class's database with pooling left <em>enabled</em>, so the many
    /// short-lived contexts across tests reuse sockets instead of opening one each time.
    /// </summary>
    private string PooledConnectionString(string databaseName) =>
        new NpgsqlConnectionStringBuilder(_fixture.ConnectionString)
        {
            Database = databaseName,
        }.ConnectionString;
}
