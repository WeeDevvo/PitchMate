using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using PitchMate.Application.Matches.UseCases;
using PitchMate.Domain.Matches;
using PitchMate.Domain.Squads;
using PitchMate.Infrastructure.Matches.Repositories;
using PitchMate.Infrastructure.Persistence;
using PitchMate.Infrastructure.Squads.Repositories;
using PitchMate.Infrastructure.Tests.Persistence;
using PitchMate.Infrastructure.Tests.Squads;

namespace PitchMate.Infrastructure.Tests.Matches;

/// <summary>
/// Audit-stamping integration test for match-draft creation, exercised against a <em>real</em>
/// PostgreSQL instance via the shared Testcontainers fixture with the production EF Core migrations
/// applied — never the EF in-memory provider or SQLite — so it observes the actual save-time audit
/// stamping performed by <see cref="PitchMateDbContext"/> (the audit fields from
/// <see cref="PitchMate.Domain.Common.BaseEntity"/>, the injected <see cref="TimeProvider"/> clock,
/// and the current-user accessor). Each test runs against its own freshly created, migrated database
/// on the shared server, so it is isolated from every other test.
/// <para>
/// This test drives the whole <see cref="CreateMatchDraftHandler"/> use case end-to-end against real
/// EF repositories and a committed <see cref="UnitOfWork"/>, exactly as a request would: the acting
/// admin is both the authorised organiser resolved from the squad's membership and the current actor
/// reported by the <see cref="FakeCurrentUserAccessor"/> (the access-token subject in production).
/// It confirms that when an Admin creates a match draft, the creating admin's identity is recorded in
/// the match's <c>CreatedBy</c> (and <c>UpdatedBy</c>) audit field on the persisted row.
/// </para>
/// <para>Validates: Requirements 1.7.</para>
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class MatchAuditStampingIntegrationTests
{
    private readonly PostgreSqlContainerFixture _fixture;

    /// <summary>Receives the shared PostgreSQL container fixture from the collection.</summary>
    /// <param name="fixture">The shared, container-backed persistence fixture.</param>
    public MatchAuditStampingIntegrationTests(PostgreSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    // Requirement 1.7 — when an Admin creates a match draft, the creating admin's identity is recorded
    // in the match's audit fields provided by BaseEntity.
    /// <summary>
    /// Creating a match draft as an Admin records that admin's identity in the persisted match's
    /// <c>CreatedBy</c> and <c>UpdatedBy</c> audit fields (stamped from the current-user accessor), and
    /// the created match owned by the squad is persisted in <see cref="MatchState.GatheringAvailability"/>.
    /// </summary>
    [Fact]
    public async Task CreatingDraftAsAdmin_RecordsAdminIdentityInAuditFields()
    {
        await WithMigratedDatabaseAsync(async connectionString =>
        {
            var clock = new FakeTimeProvider();
            var nowUtc = clock.GetUtcNow();

            // The acting admin's user identity. In production the current-user accessor reports the
            // access-token subject claim; audit stamping records that string in CreatedBy/UpdatedBy.
            var adminUserId = Guid.CreateVersion7();
            var adminIdentity = adminUserId.ToString();

            // --- Seed a squad with an active owner (an Admin) whose UserId is the acting admin. ---
            Squad squad = Squad.Create("Weekend Warriors").Value!;
            var squadId = squad.Id;

            await using (var seed = CreateContext(connectionString, clock, new FakeCurrentUserAccessor()))
            {
                await new EfSquadRepository(seed).AddAsync(squad, CancellationToken.None);
                SquadMembership owner =
                    SquadMembership.CreateOwner(squadId, adminUserId, "Skipper").Value!;
                await new EfSquadMembershipRepository(seed).AddAsync(owner, CancellationToken.None);
                await new UnitOfWork(seed).SaveChangesAsync(CancellationToken.None);
            }

            // --- Create the draft through the handler, with the admin as the current actor. ---
            Guid matchId;
            await using (var act = CreateContext(connectionString, clock, new FakeCurrentUserAccessor(adminIdentity)))
            {
                var handler = new CreateMatchDraftHandler(
                    new EfMatchRepository(act),
                    new EfSquadMembershipRepository(act),
                    new EfSquadRepository(act),
                    new UnitOfWork(act),
                    clock,
                    new NoOpNotificationPublisher(),
                    NullLogger<CreateMatchDraftHandler>.Instance);

                var command = new CreateMatchDraftCommand(
                    adminUserId,
                    squadId,
                    "Hackney Marshes, Pitch 3",
                    [nowUtc.AddDays(7), nowUtc.AddDays(14)]);

                PitchMate.Domain.Matches.Result<CreateMatchDraftResult> result =
                    await handler.HandleAsync(command, CancellationToken.None);

                Assert.True(result.IsSuccess, result.Error?.Message);
                matchId = result.Value!.MatchId;
            }

            // --- Reload through a fresh context and assert the admin's identity was stamped. ---
            await using (var read = CreateContext(connectionString, clock, new FakeCurrentUserAccessor()))
            {
                Match? reloaded = await new EfMatchRepository(read).GetByIdAsync(matchId, CancellationToken.None);

                Assert.NotNull(reloaded);
                Assert.Equal(squadId, reloaded!.SquadId);
                Assert.Equal(MatchState.GatheringAvailability, reloaded.State);

                // Requirement 1.7 — the creating admin's identity is recorded in the audit fields.
                Assert.Equal(adminIdentity, reloaded.CreatedBy);
                Assert.Equal(adminIdentity, reloaded.UpdatedBy);
                Assert.Equal(nowUtc, reloaded.CreatedAt);
            }
        });
    }

    /// <summary>
    /// Creates a production <see cref="PitchMateDbContext"/> bound to the throwaway database using the
    /// supplied clock and current-user accessor, so audit stamping observes a controllable instant and
    /// actor.
    /// </summary>
    private static PitchMateDbContext CreateContext(
        string connectionString, TimeProvider clock, FakeCurrentUserAccessor currentUser) =>
        new(MigrationTestSupport.BuildContextOptions(connectionString), clock, currentUser);

    /// <summary>
    /// Creates a uniquely-named empty database on the shared server, applies the production EF Core
    /// migrations to it, runs the test body against a connection string targeting it, and drops it
    /// afterwards regardless of outcome.
    /// </summary>
    private async Task WithMigratedDatabaseAsync(Func<string, Task> body)
    {
        var databaseName = "match_audit_" + Guid.NewGuid().ToString("N");
        await MigrationTestSupport.CreateDatabaseAsync(_fixture.ConnectionString, databaseName);

        try
        {
            var connectionString =
                MigrationTestSupport.ConnectionStringForDatabase(_fixture.ConnectionString, databaseName);

            await using (var schema = CreateContext(connectionString, new FakeTimeProvider(), new FakeCurrentUserAccessor()))
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
