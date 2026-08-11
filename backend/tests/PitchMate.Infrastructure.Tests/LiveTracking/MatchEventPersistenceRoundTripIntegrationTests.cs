using Microsoft.EntityFrameworkCore;
using PitchMate.Domain.LiveTracking;
using PitchMate.Domain.Squads;
using PitchMate.Infrastructure.LiveTracking;
using PitchMate.Infrastructure.Persistence;
using PitchMate.Infrastructure.Squads.Repositories;
using PitchMate.Infrastructure.Tests.Persistence;

namespace PitchMate.Infrastructure.Tests.LiveTracking;

/// <summary>
/// Persistence round-trip integration tests for the append-only <see cref="MatchEvent"/> log,
/// exercised against a <em>real</em> PostgreSQL instance via the shared Testcontainers fixture with
/// the production EF Core migrations applied — never the EF in-memory provider or SQLite — so they
/// observe the actual table-per-hierarchy discriminator, <c>uuid</c>/<c>timestamptz</c> mapping, the
/// <see cref="MatchMinute"/> value-converter, and audit-stamping behaviour (per coding-standards:
/// "run against real PostgreSQL via Testcontainers, and apply EF migrations against the container").
/// Each test runs against its own freshly created, migrated database on the shared server, so it is
/// isolated from every other test.
/// <para>
/// The tests confirm two guarantees:
/// </para>
/// <list type="number">
/// <item>The <c>AddMatchEvent</c> migration applies cleanly to a fresh database, creating the
/// <c>match_events</c> table (Requirement 1.6).</item>
/// <item>Each of the four concrete <see cref="MatchEvent"/> subclasses appended through
/// <see cref="EfMatchEventRepository"/> reloads faithfully — its client-supplied GUID v7
/// <c>Event_Id</c>, <c>MatchId</c>, <c>SquadId</c>, <see cref="EventKind"/> discriminator (materialised
/// as the concrete CLR type), <see cref="MatchMinute"/>, the per-subclass payload columns, and the
/// audit fields are all preserved (Requirement 1.6).</item>
/// </list>
/// <para>Validates: Requirements 1.6.</para>
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class MatchEventPersistenceRoundTripIntegrationTests
{
    private const string Actor = "coach-42";

    private readonly PostgreSqlContainerFixture _fixture;

    /// <summary>Receives the shared PostgreSQL container fixture from the collection.</summary>
    /// <param name="fixture">The shared, container-backed persistence fixture.</param>
    public MatchEventPersistenceRoundTripIntegrationTests(PostgreSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    // Requirement 1.6 — the production migrations, including AddMatchEvent, apply cleanly to a fresh
    // database, creating the match_events table.
    /// <summary>
    /// Applying the production EF Core migrations to a fresh database creates the
    /// <c>match_events</c> table.
    /// </summary>
    [Fact]
    public async Task Migrations_ApplyCleanly_CreatingTheMatchEventsTable()
    {
        await WithMigratedDatabaseAsync(async connectionString =>
        {
            Assert.True(
                await MigrationTestSupport.TableExistsAsync(connectionString, "public", "match_events"),
                "Expected the 'match_events' table to exist after applying migrations.");
        });
    }

    // Requirement 1.6 — every concrete subclass round-trips faithfully with its Event_Id, MatchId,
    // SquadId, EventKind discriminator, Minute, per-subclass payload, and audit fields.
    /// <summary>
    /// One event of each of the four kinds — appended in a single batch and reloaded through a fresh
    /// context — reloads as its concrete CLR type with every common and per-subclass field, plus the
    /// audit fields, preserved.
    /// </summary>
    [Fact]
    public async Task EachSubclass_RoundTripsFaithfully_ViaRepository()
    {
        await WithMigratedDatabaseAsync(async connectionString =>
        {
            var clock = new FakeTimeProvider();
            var nowUtc = clock.GetUtcNow();

            // --- Seed the owning squad (FK target for every event's SquadId). ---
            Squad squad = Squad.Create("Weekend Warriors").Value!;
            var squadId = squad.Id;

            await using (var seed = CreateContext(connectionString, clock))
            {
                await new EfSquadRepository(seed).AddAsync(squad, CancellationToken.None);
                await new UnitOfWork(seed).SaveChangesAsync(CancellationToken.None);
            }

            // --- Build one event of each concrete kind, sharing a match and squad. ---
            var matchId = Guid.CreateVersion7();
            var scoringTeamId = Guid.CreateVersion7();
            var scorerMembershipId = Guid.CreateVersion7();
            var keeperMembershipId = Guid.CreateVersion7();
            var keptTeamId = Guid.CreateVersion7();

            var goalScored = new GoalScoredEvent(
                Guid.CreateVersion7(), matchId, squadId, MatchMinute.Create(12).Value,
                scoringTeamId, scorerMembershipId, ownGoal: true);

            var goalRetracted = new GoalRetractedEvent(
                Guid.CreateVersion7(), matchId, squadId, MatchMinute.Create(13).Value,
                targetEventId: goalScored.Id);

            var keeperStarted = new KeeperStintStartedEvent(
                Guid.CreateVersion7(), matchId, squadId, MatchMinute.Create(0).Value,
                keeperMembershipId, keptTeamId);

            var keeperRetracted = new KeeperStintRetractedEvent(
                Guid.CreateVersion7(), matchId, squadId, MatchMinute.Create(45).Value,
                targetEventId: keeperStarted.Id);

            MatchEvent[] events = [goalScored, goalRetracted, keeperStarted, keeperRetracted];

            // --- Append the log atomically through the append-only repository. ---
            await using (var write = CreateContext(connectionString, clock))
            {
                await new EfMatchEventRepository(write).AppendAsync(events, CancellationToken.None);
                await new UnitOfWork(write).SaveChangesAsync(CancellationToken.None);
            }

            // --- Reload through a fresh context and assert a faithful round-trip. ---
            await using (var read = CreateContext(connectionString, clock))
            {
                IReadOnlyList<MatchEvent> reloaded =
                    await new EfMatchEventRepository(read).GetForMatchAsync(matchId, CancellationToken.None);

                Assert.Equal(4, reloaded.Count);

                // Every event kept its identity, match/squad association, kind, and minute, and
                // materialised as the correct concrete CLR type (the TPH discriminator).
                var byId = reloaded.ToDictionary(e => e.Id);
                foreach (var original in events)
                {
                    MatchEvent loaded = byId[original.Id];
                    Assert.Equal(original.GetType(), loaded.GetType());
                    Assert.Equal(matchId, loaded.MatchId);
                    Assert.Equal(squadId, loaded.SquadId);
                    Assert.Equal(original.Kind, loaded.Kind);
                    Assert.Equal(original.Minute, loaded.Minute);

                    // Audit fields stamped on insert against the controllable clock and actor.
                    Assert.Equal(nowUtc, loaded.CreatedAt);
                    Assert.Equal(nowUtc, loaded.UpdatedAt);
                    Assert.Equal(Actor, loaded.CreatedBy);
                    Assert.Equal(Actor, loaded.UpdatedBy);
                    Assert.False(loaded.IsDeleted);
                }

                // GoalScoredEvent payload.
                var reloadedGoal = Assert.IsType<GoalScoredEvent>(byId[goalScored.Id]);
                Assert.Equal(EventKind.GoalScored, reloadedGoal.Kind);
                Assert.Equal(scoringTeamId, reloadedGoal.ScoringTeamId);
                Assert.Equal(scorerMembershipId, reloadedGoal.ScorerMembershipId);
                Assert.True(reloadedGoal.OwnGoal);

                // GoalRetractedEvent payload.
                var reloadedGoalRetraction = Assert.IsType<GoalRetractedEvent>(byId[goalRetracted.Id]);
                Assert.Equal(EventKind.GoalRetracted, reloadedGoalRetraction.Kind);
                Assert.Equal(goalScored.Id, reloadedGoalRetraction.TargetEventId);

                // KeeperStintStartedEvent payload.
                var reloadedStint = Assert.IsType<KeeperStintStartedEvent>(byId[keeperStarted.Id]);
                Assert.Equal(EventKind.KeeperStintStarted, reloadedStint.Kind);
                Assert.Equal(keeperMembershipId, reloadedStint.KeeperMembershipId);
                Assert.Equal(keptTeamId, reloadedStint.KeptTeamId);

                // KeeperStintRetractedEvent payload.
                var reloadedStintRetraction = Assert.IsType<KeeperStintRetractedEvent>(byId[keeperRetracted.Id]);
                Assert.Equal(EventKind.KeeperStintRetracted, reloadedStintRetraction.Kind);
                Assert.Equal(keeperStarted.Id, reloadedStintRetraction.TargetEventId);
            }
        });
    }

    // Requirement 3.7 — the optional scorer is genuinely nullable through the round-trip.
    /// <summary>
    /// A goal-scored event recorded without a scorer reloads with a <see langword="null"/>
    /// <see cref="GoalScoredEvent.ScorerMembershipId"/>, confirming the nullable per-subclass column
    /// round-trips faithfully.
    /// </summary>
    [Fact]
    public async Task GoalScoredEvent_WithoutScorer_RoundTripsWithNullScorer()
    {
        await WithMigratedDatabaseAsync(async connectionString =>
        {
            var clock = new FakeTimeProvider();

            Squad squad = Squad.Create("Sunday League").Value!;
            var squadId = squad.Id;

            await using (var seed = CreateContext(connectionString, clock))
            {
                await new EfSquadRepository(seed).AddAsync(squad, CancellationToken.None);
                await new UnitOfWork(seed).SaveChangesAsync(CancellationToken.None);
            }

            var matchId = Guid.CreateVersion7();
            var goal = new GoalScoredEvent(
                Guid.CreateVersion7(), matchId, squadId, MatchMinute.Create(77).Value,
                scoringTeamId: Guid.CreateVersion7(), scorerMembershipId: null, ownGoal: false);

            await using (var write = CreateContext(connectionString, clock))
            {
                await new EfMatchEventRepository(write).AppendAsync([goal], CancellationToken.None);
                await new UnitOfWork(write).SaveChangesAsync(CancellationToken.None);
            }

            await using (var read = CreateContext(connectionString, clock))
            {
                IReadOnlyList<MatchEvent> reloaded =
                    await new EfMatchEventRepository(read).GetForMatchAsync(matchId, CancellationToken.None);

                var reloadedGoal = Assert.IsType<GoalScoredEvent>(Assert.Single(reloaded));
                Assert.Null(reloadedGoal.ScorerMembershipId);
                Assert.False(reloadedGoal.OwnGoal);
                Assert.Equal(77, reloadedGoal.Minute.Value);
            }
        });
    }

    /// <summary>
    /// Creates a production <see cref="PitchMateDbContext"/> bound to the throwaway database using the
    /// supplied clock and a known actor so audit stamping observes a controllable instant and actor.
    /// </summary>
    private static PitchMateDbContext CreateContext(string connectionString, TimeProvider clock) =>
        new(
            MigrationTestSupport.BuildContextOptions(connectionString),
            clock,
            new FakeCurrentUserAccessor(Actor));

    /// <summary>
    /// Creates a uniquely-named empty database on the shared server, applies the production EF Core
    /// migrations to it (validating the <c>AddMatchEvent</c> migration too), runs the test body against
    /// a connection string targeting it, and drops it afterwards regardless of outcome.
    /// </summary>
    private async Task WithMigratedDatabaseAsync(Func<string, Task> body)
    {
        var databaseName = "matchevent_" + Guid.NewGuid().ToString("N");
        await MigrationTestSupport.CreateDatabaseAsync(_fixture.ConnectionString, databaseName);

        try
        {
            var connectionString =
                MigrationTestSupport.ConnectionStringForDatabase(_fixture.ConnectionString, databaseName);

            await using (var schema = CreateContext(connectionString, new FakeTimeProvider()))
            {
                await schema.Database.MigrateAsync();
            }

            await body(connectionString);
        }
        finally
        {
            await MigrationTestSupport.DropDatabaseAsync(_fixture.ConnectionString, databaseName);
        }
    }
}
