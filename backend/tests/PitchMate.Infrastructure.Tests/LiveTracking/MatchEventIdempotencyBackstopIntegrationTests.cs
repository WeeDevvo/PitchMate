using Microsoft.EntityFrameworkCore;
using PitchMate.Application.Common.Persistence;
using PitchMate.Domain.LiveTracking;
using PitchMate.Domain.Squads;
using PitchMate.Infrastructure.LiveTracking;
using PitchMate.Infrastructure.Persistence;
using PitchMate.Infrastructure.Squads.Repositories;
using PitchMate.Infrastructure.Tests.Persistence;

namespace PitchMate.Infrastructure.Tests.LiveTracking;

/// <summary>
/// Concurrency integration test for the append-only <see cref="MatchEvent"/> log's
/// idempotency backstop, exercised against a <em>real</em> PostgreSQL instance via the shared
/// Testcontainers fixture with the production EF Core migrations applied — never the EF in-memory
/// provider or SQLite — so it observes actual PostgreSQL primary-key uniqueness and transaction
/// behaviour under contention (per coding-standards: in-memory/SQLite substitutes "hide constraint,
/// transaction, and concurrency bugs").
/// <para>
/// The recording handler classifies each event against a pre-loaded id set within its transaction, but
/// two admins (or a retrying client) can still race two recordings of the <em>same</em> client-generated
/// GUID v7 <c>Event_Id</c> whose classifications both see an empty log. The <c>Event_Id</c> <em>is</em>
/// the primary key, so that primary-key uniqueness is the backstop: one writer wins and appends the
/// single row, and the loser's insert collides on the key and surfaces a
/// <see cref="DuplicateKeyException"/>, which reconciles to a <see cref="EventOutcome.Duplicate"/>
/// outcome — leaving exactly one row and never double-counting (Requirement 1.2, 1.5).
/// </para>
/// <para>Validates: Requirements 1.2, 1.5.</para>
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class MatchEventIdempotencyBackstopIntegrationTests
{
    private const string Actor = "race-condition-actor";

    private readonly PostgreSqlContainerFixture _fixture;

    /// <summary>Receives the shared PostgreSQL container fixture from the collection.</summary>
    /// <param name="fixture">The shared, container-backed persistence fixture.</param>
    public MatchEventIdempotencyBackstopIntegrationTests(PostgreSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    // Requirement 1.2, 1.5 — under concurrency the primary-key uniqueness on Event_Id is the backstop:
    // two racing recordings of the same Event_Id insert exactly one row; the loser reconciles to
    // Duplicate and the stored log is identical to its state after the first Applied recording.
    /// <summary>
    /// Two independent units of work each append an event carrying the <em>same</em> client-generated
    /// <c>Event_Id</c> and race their commits; exactly one commit succeeds (<see cref="EventOutcome.Applied"/>),
    /// the other collides on the primary key and reconciles to <see cref="EventOutcome.Duplicate"/>, and
    /// exactly one row is persisted for that <c>Event_Id</c>.
    /// </summary>
    [Fact]
    public async Task ConcurrentRecordingsOfSameEventId_InsertExactlyOneRow_LoserReconcilesToDuplicate()
    {
        await WithMigratedDatabaseAsync(async connectionString =>
        {
            var clock = new FakeTimeProvider();

            // --- Seed the owning squad (FK target for the event's SquadId). ---
            Squad squad = Squad.Create("Race Condition FC").Value!;
            var squadId = squad.Id;

            await using (var seed = CreateContext(connectionString, clock))
            {
                await new EfSquadRepository(seed).AddAsync(squad, CancellationToken.None);
                await new UnitOfWork(seed).SaveChangesAsync(CancellationToken.None);
            }

            // --- The single client-generated Event_Id both writers race on. ---
            var matchId = Guid.CreateVersion7();
            var sharedEventId = Guid.CreateVersion7();
            var scoringTeamId = Guid.CreateVersion7();

            // Two independent contexts (own connections, pooling disabled) each stage an insert of the
            // same Event_Id, mirroring two admins / a retrying client whose duplicate classification
            // both saw an empty log.
            await using var contextOne = CreateContext(connectionString, clock);
            await using var contextTwo = CreateContext(connectionString, clock);

            var eventOne = new GoalScoredEvent(
                sharedEventId, matchId, squadId, MatchMinute.Create(10).Value,
                scoringTeamId, scorerMembershipId: null, ownGoal: false);
            var eventTwo = new GoalScoredEvent(
                sharedEventId, matchId, squadId, MatchMinute.Create(10).Value,
                scoringTeamId, scorerMembershipId: null, ownGoal: false);

            await new EfMatchEventRepository(contextOne).AppendAsync([eventOne], CancellationToken.None);
            await new EfMatchEventRepository(contextTwo).AppendAsync([eventTwo], CancellationToken.None);

            // --- Race both commits; each writer reconciles its own outcome. ---
            RecordOutcome[] outcomes = await Task.WhenAll(
                CommitAndReconcileAsync(contextOne, sharedEventId),
                CommitAndReconcileAsync(contextTwo, sharedEventId));

            // Exactly one writer Applied the row; the loser reconciled to Duplicate.
            Assert.Equal(1, outcomes.Count(outcome => outcome.Outcome == EventOutcome.Applied));
            Assert.Equal(1, outcomes.Count(outcome => outcome.Outcome == EventOutcome.Duplicate));
            Assert.All(outcomes, outcome => Assert.Equal(sharedEventId, outcome.EventId));

            // --- Exactly one row is persisted for that Event_Id. ---
            await using var verify = CreateContext(connectionString, clock);
            IReadOnlyList<MatchEvent> stored =
                await new EfMatchEventRepository(verify).GetForMatchAsync(matchId, CancellationToken.None);

            var only = Assert.Single(stored);
            Assert.Equal(sharedEventId, only.Id);
            Assert.IsType<GoalScoredEvent>(only);
        });
    }

    /// <summary>
    /// Commits the context's staged append and reconciles the result: a clean commit is
    /// <see cref="EventOutcome.Applied"/>; a primary-key collision surfaces a
    /// <see cref="DuplicateKeyException"/> — the idempotency backstop — and reconciles to
    /// <see cref="EventOutcome.Duplicate"/> (Requirement 1.2, 1.5).
    /// </summary>
    private static async Task<RecordOutcome> CommitAndReconcileAsync(
        PitchMateDbContext context, Guid eventId)
    {
        try
        {
            await new UnitOfWork(context).SaveChangesAsync(CancellationToken.None);
            return RecordOutcome.Applied(eventId);
        }
        catch (DuplicateKeyException)
        {
            // The winning writer already inserted this Event_Id; the primary-key uniqueness backstop
            // fired, so this recording is a no-op duplicate rather than a second row.
            return RecordOutcome.Duplicate(eventId);
        }
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
    /// migrations to it, runs the test body against a connection string targeting it, and drops it
    /// afterwards regardless of outcome.
    /// </summary>
    private async Task WithMigratedDatabaseAsync(Func<string, Task> body)
    {
        var databaseName = "matchevent_backstop_" + Guid.NewGuid().ToString("N");
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
