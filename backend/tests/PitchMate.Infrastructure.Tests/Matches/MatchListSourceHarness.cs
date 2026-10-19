using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Metadata;
using Npgsql;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Matches.UseCases;
using PitchMate.Domain.Matches;
using PitchMate.Domain.Squads;
using PitchMate.Infrastructure.Matches.Queries;
using PitchMate.Infrastructure.Matches.Repositories;
using PitchMate.Infrastructure.Persistence;
using PitchMate.Infrastructure.Squads.Repositories;
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
    /// Runs the real <see cref="EfMatchDetailSource"/> over a fresh context (match-read-models task 10.6).
    /// </summary>
    /// <param name="matchId">The match to read.</param>
    public async Task<MatchDetailProjection?> FindDetailAsync(Guid matchId)
    {
        await EnsureDatabaseAsync();

        await using PitchMateDbContext read = CreateContext();
        return await new EfMatchDetailSource(read).FindAsync(matchId, CancellationToken.None);
    }

    /// <summary>
    /// Runs the real <see cref="GetMatchDetailHandler"/> over the production EF gateways on a fresh
    /// context, as the given user — the path the detail endpoint takes below the transport.
    /// </summary>
    /// <param name="userId">The calling user.</param>
    /// <param name="matchId">The match to read.</param>
    public async Task<PitchMate.Domain.Matches.Result<MatchDetail>> GetDetailAsync(Guid userId, Guid matchId)
    {
        await EnsureDatabaseAsync();

        await using PitchMateDbContext read = CreateContext();
        var handler = new GetMatchDetailHandler(
            new EfMatchDetailSource(read),
            new EfSquadMembershipRepository(read),
            new EfAvailabilityRepository(read));

        return await handler.HandleAsync(new GetMatchDetailCommand(userId, matchId), CancellationToken.None);
    }

    /// <summary>
    /// Runs the real <see cref="GetAvailabilityTallyHandler"/> over the production EF gateways, as the
    /// given user, so the detail's caller availability can be checked against the tally.
    /// </summary>
    public async Task<PitchMate.Domain.Matches.Result<AvailabilityTally>> GetTallyAsync(Guid userId, Guid squadId, Guid matchId)
    {
        await EnsureDatabaseAsync();

        await using PitchMateDbContext read = CreateContext();
        var handler = new GetAvailabilityTallyHandler(
            new EfMatchRepository(read),
            new EfSquadMembershipRepository(read),
            new EfAvailabilityRepository(read));

        return await handler.HandleAsync(new GetAvailabilityTallyCommand(userId, squadId, matchId), CancellationToken.None);
    }

    /// <summary>Runs the real <see cref="EfWorkingTeamsSource"/> over a fresh context (task 11.6).</summary>
    public async Task<WorkingTeamsProjection?> FindWorkingTeamsAsync(Guid matchId)
    {
        await EnsureDatabaseAsync();

        await using PitchMateDbContext read = CreateContext();
        return await new EfWorkingTeamsSource(read).FindAsync(matchId, CancellationToken.None);
    }

    /// <summary>
    /// Runs the real <see cref="EfWorkingTeamsSource"/> over a context carrying a command interceptor,
    /// so a test can assert the fixed statement count.
    /// </summary>
    public async Task<(WorkingTeamsProjection? Projection, CommandCountingInterceptor Commands)> FindWorkingTeamsCapturingCommandsAsync(Guid matchId)
    {
        await EnsureDatabaseAsync();

        var commands = new CommandCountingInterceptor();
        await using PitchMateDbContext read = CreateContext(commands);
        return (await new EfWorkingTeamsSource(read).FindAsync(matchId, CancellationToken.None), commands);
    }

    /// <summary>
    /// Runs the real <see cref="GetWorkingTeamsHandler"/> over the production EF gateways and the given
    /// rating engine, as the given user.
    /// </summary>
    public async Task<PitchMate.Domain.Matches.Result<WorkingTeamsView>> GetWorkingTeamsAsync(
        Guid userId, Guid matchId, PitchMate.Domain.Rating.IRatingEngine engine)
    {
        await EnsureDatabaseAsync();

        await using PitchMateDbContext read = CreateContext();
        var handler = new GetWorkingTeamsHandler(new EfWorkingTeamsSource(read), new EfSquadMembershipRepository(read), engine);
        return await handler.HandleAsync(new GetWorkingTeamsCommand(userId, matchId), CancellationToken.None);
    }

    /// <summary>
    /// Runs the real <see cref="AdjustTeamsHandler"/> — the use case behind the team-editing writes —
    /// over the production EF gateways and balancer, as the given user, committing on success.
    /// </summary>
    public async Task<PitchMate.Domain.Matches.Result> AdjustTeamsAsync(
        Guid userId, Guid matchId, TeamAdjustment adjustment, PitchMate.Domain.Rating.IRatingEngine engine)
    {
        await EnsureDatabaseAsync();

        await using PitchMateDbContext write = CreateContext();
        var handler = new AdjustTeamsHandler(
            new EfMatchRepository(write),
            new EfSquadMembershipRepository(write),
            new EfMembershipRatingRepository(write),
            engine,
            new PitchMate.Infrastructure.Matches.TeamBalancer(engine),
            new PitchMate.Infrastructure.Matches.SillyNameGenerator(),
            new UnitOfWork(write));

        return await handler.HandleAsync(new AdjustTeamsCommand(userId, matchId, adjustment), CancellationToken.None);
    }

    /// <summary>
    /// Appends an identity to a team's stored roster by direct SQL, bypassing the aggregate — the
    /// negative-control plant <c>MembershipStandingScopeHarness.AppendToTeamRosterAsync</c> uses, exposed
    /// here for the working-teams and team-sheet reads (tasks 11.6, 13.7).
    /// </summary>
    public async Task AppendToTeamRosterAsync(Guid teamId, Guid membershipId)
    {
        await EnsureDatabaseAsync();

        await using PitchMateDbContext write = CreateContext();
        MappedTable team = MappedTable.For(write.Model, typeof(MatchTeam));
        string roster = team.Column(nameof(MatchTeam.Roster));
        string key = team.Column(nameof(MatchTeam.Id));

        // Names come from the EF model; {0} / {1} are sent as typed parameters, never inlined.
        var sql = $"UPDATE \"{team.Table}\" SET \"{roster}\" = \"{roster}\" || CAST({{0}} AS uuid) WHERE \"{key}\" = {{1}}";
        int affected = await write.Database.ExecuteSqlRawAsync(sql, membershipId, teamId);

        Assert.Equal(1, affected);
    }

    /// <summary>
    /// Copies an existing participant row into another match by direct SQL — fresh identity, the target
    /// match, a roster position after every other — bypassing the aggregate's same-squad rule. Used to
    /// plant another squad's membership as a participant, so the squad-scoping of the read's membership
    /// join is load-bearing rather than vacuous.
    /// </summary>
    public async Task PlantParticipantCopyAsync(Guid sourceMatchId, Guid membershipId, Guid targetMatchId)
    {
        await EnsureDatabaseAsync();

        await using PitchMateDbContext write = CreateContext();
        IEntityType entity = write.Model.FindEntityType(typeof(MatchParticipant))!;
        MappedTable participant = MappedTable.For(write.Model, typeof(MatchParticipant));
        string id = participant.Column(nameof(MatchParticipant.Id));
        string match = participant.Column(nameof(MatchParticipant.MatchId));
        string member = participant.Column(nameof(MatchParticipant.SquadMembershipId));
        string position = participant.Column(nameof(MatchParticipant.RosterPosition));

        // xmin is PostgreSQL's system column behind the concurrency token; it cannot be inserted.
        List<string> columns =
        [
            .. entity.GetProperties()
                .Select(property => participant.Column(property.Name))
                .Where(static column => column != "xmin"),
        ];
        string select = string.Join(", ", columns.Select(column =>
            column == id ? "gen_random_uuid()"
            : column == match ? "{1}"
            : column == position ? "1000"
            : $"p.\"{column}\""));

        // Names come from the EF model; {0} / {1} / {2} are sent as typed parameters, never inlined.
        var sql =
            $"INSERT INTO \"{participant.Table}\" ({string.Join(", ", columns.Select(static column => $"\"{column}\""))}) " +
            $"SELECT {select} FROM \"{participant.Table}\" AS p WHERE p.\"{match}\" = {{0}} AND p.\"{member}\" = {{2}}";
        int affected = await write.Database.ExecuteSqlRawAsync(sql, sourceMatchId, targetMatchId, membershipId);

        Assert.Equal(1, affected);
    }

    /// <summary>Runs the real <see cref="EfRosterDisplayNameSource"/> over a fresh context (task 13.7).</summary>
    public async Task<IReadOnlyDictionary<Guid, string>> ListRosterNamesAsync(Guid matchId)
    {
        await EnsureDatabaseAsync();

        await using PitchMateDbContext read = CreateContext();
        return await new EfRosterDisplayNameSource(read).ListForMatchAsync(matchId, CancellationToken.None);
    }

    /// <summary>
    /// Runs the real <see cref="GetTeamSheetHandler"/> over the production EF gateways and display-name
    /// source, as the given user.
    /// </summary>
    public async Task<PitchMate.Domain.Matches.Result<TeamSheet>> GetTeamSheetAsync(Guid userId, Guid matchId)
    {
        await EnsureDatabaseAsync();

        await using PitchMateDbContext read = CreateContext();
        var handler = new GetTeamSheetHandler(
            new EfMatchRepository(read), new EfSquadMembershipRepository(read), new EfRosterDisplayNameSource(read));
        return await handler.HandleAsync(new GetTeamSheetCommand(userId, matchId), CancellationToken.None);
    }

    /// <summary>
    /// Moves the first player of the first locked team to the second and re-locks, through the aggregate
    /// loaded and saved by the production repository, returning the moved identity.
    /// </summary>
    public async Task<Guid> MoveAndRelockAsync(Guid matchId)
    {
        await EnsureDatabaseAsync();

        await using PitchMateDbContext write = CreateContext();
        Match match = (await new EfMatchRepository(write).GetByIdAsync(matchId, CancellationToken.None))!;
        KickoffTeam first = match.KickoffLineup!.Teams[0];
        Guid moving = first.ParticipantMembershipIds[0];
        Guid toTeam = match.Teams.Single(team => !team.Roster.Contains(moving)).Id;

        Assert.True(match.MoveParticipant(moving, toTeam).IsSuccess);
        Assert.True(match.Lock().IsSuccess);
        await new UnitOfWork(write).SaveChangesAsync(CancellationToken.None);

        return moving;
    }

    /// <summary>
    /// Marks one participant row deleted by direct update, bypassing the aggregate, so a locked lineup
    /// names an identity for which the match holds no live participant — the team sheet's form of the
    /// no-participant plant, since the sheet reads the captured lineup rather than the team rosters.
    /// </summary>
    public async Task PlantDeletedParticipantAsync(Guid matchId, Guid membershipId)
    {
        await EnsureDatabaseAsync();

        await using PitchMateDbContext write = CreateContext();
        int updated = await write.Set<MatchParticipant>()
            .IgnoreQueryFilters()
            .Where(participant => participant.MatchId == matchId && participant.SquadMembershipId == membershipId)
            .ExecuteUpdateAsync(setters => setters.SetProperty(participant => participant.IsDeleted, true));

        Assert.Equal(1, updated);
    }

    /// <summary>Loads the match aggregate as the production repository rehydrates it.</summary>
    public async Task<Match> LoadMatchAsync(Guid matchId)
    {
        await EnsureDatabaseAsync();

        await using PitchMateDbContext read = CreateContext();
        return (await new EfMatchRepository(read).GetByIdAsync(matchId, CancellationToken.None))!;
    }

    /// <summary>Soft-deletes one membership through the production save pipeline.</summary>
    public Task SoftDeleteMembershipAsync(Guid membershipId) => SoftDeleteAsync<SquadMembership>(membershipId);

    /// <summary>
    /// Removes one membership's stored availability response for a match outright, so a property can
    /// show that another member's reported availability does not move when it changes.
    /// </summary>
    public async Task RemoveResponseAsync(Guid matchId, Guid membershipId)
    {
        await EnsureDatabaseAsync();

        await using PitchMateDbContext write = CreateContext();
        int removed = await write.Set<AvailabilityResponse>()
            .Where(response => response.MatchId == matchId && response.SquadMembershipId == membershipId)
            .ExecuteDeleteAsync();

        Assert.Equal(1, removed);
    }

    /// <summary>
    /// Overwrites one participant's captured display name in place — a state the aggregates cannot
    /// produce, since a membership's name is validated non-blank — so the blank-name branch of the
    /// display-name rule can be exercised against the SQL.
    /// </summary>
    /// <param name="matchId">The match.</param>
    /// <param name="membershipId">The participant's squad-membership identity.</param>
    /// <param name="capturedName">The captured name to plant.</param>
    public async Task PlantCapturedDisplayNameAsync(Guid matchId, Guid membershipId, string capturedName)
    {
        await EnsureDatabaseAsync();

        await using PitchMateDbContext write = CreateContext();
        int updated = await write.Set<MatchParticipant>()
            .Where(participant => participant.MatchId == matchId && participant.SquadMembershipId == membershipId)
            .ExecuteUpdateAsync(setters => setters.SetProperty(participant => participant.DisplayName, capturedName));

        Assert.Equal(1, updated);
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
