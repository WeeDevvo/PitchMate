using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using PitchMate.Application.Common;
using PitchMate.Application.Common.Persistence;
using PitchMate.Application.Notifications;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Application.Squads.UseCases;
using PitchMate.Domain.Squads;
using PitchMate.Infrastructure.Auth.Repositories;
using PitchMate.Infrastructure.Persistence;
using PitchMate.Infrastructure.Squads;
using PitchMate.Infrastructure.Squads.Repositories;
using PitchMate.Infrastructure.Tests.Persistence;

namespace PitchMate.Infrastructure.Tests.Squads;

/// <summary>
/// Integration tests for the squad concurrency and purge guarantees, exercised against a
/// <em>real</em> PostgreSQL instance via the shared Testcontainers fixture with the production EF
/// Core migrations applied — never the EF in-memory provider or SQLite, so they observe actual
/// PostgreSQL filtered-unique-index, transaction, and concurrency semantics (per coding-standards:
/// "run against real PostgreSQL via Testcontainers, and apply EF migrations against the container").
/// Each test runs against its own freshly created, migrated database on the shared server, so it is
/// isolated from every other test.
/// <para>
/// The tests confirm three database-enforced guarantees the change tracker alone cannot provide,
/// each concurrent operation running in its own scope (its own <see cref="PitchMateDbContext"/>,
/// repositories, and unit of work) exactly as two real concurrent requests would:
/// </para>
/// <list type="number">
/// <item>Two concurrent guest creations with the same trimmed, case-insensitive display name in one
/// squad yield exactly one membership row — the filtered unique index on
/// <c>(squad_id, display_name_normalized)</c> lets at most one win (Requirement 3.6, 11.9).</item>
/// <item>Two concurrent invite redemptions for the same user into one squad yield exactly one
/// membership row — the filtered unique index on <c>(squad_id, user_id)</c> lets at most one win
/// (Requirement 11.9).</item>
/// <item>After the clock advances past a soft-deleted squad's purge instant,
/// <see cref="PurgeSquadHandler"/> permanently removes the squad and <b>all</b> of its memberships —
/// a full squad purge is total destruction, so the anonymisation-over-deletion rule (which governs
/// erasure within a surviving squad) does not apply and no membership is retained (Requirement
/// 17.5).</item>
/// </list>
/// <para>Validates: Requirements 3.6, 11.9, 17.5.</para>
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class SquadConcurrencyAndPurgeIntegrationTests
{
    private const string JoinLinkPrefix = "https://pitch-mate.co.uk/join/";

    private readonly PostgreSqlContainerFixture _fixture;

    /// <summary>Receives the shared PostgreSQL container fixture from the collection.</summary>
    /// <param name="fixture">The shared, container-backed persistence fixture.</param>
    public SquadConcurrencyAndPurgeIntegrationTests(PostgreSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    // Requirement 3.6, 11.9 — the filtered unique index on (squad_id, display_name_normalized)
    // permits at most one of two concurrent same-name guest creations to succeed; exactly one row
    // exists afterwards and the loser is rejected (as a duplicate-key/DisplayNameInUse failure).
    /// <summary>
    /// Two concurrent guest creations for the same trimmed, case-insensitive display name in one
    /// squad — each in its own scope — result in exactly one guest membership row, with exactly one
    /// operation succeeding and the other rejected.
    /// </summary>
    [Fact]
    public async Task ConcurrentSameNameGuestCreations_YieldExactlyOneRow()
    {
        await WithMigratedDatabaseAsync(async connectionString =>
        {
            var ownerUserId = Guid.CreateVersion7();
            Guid squadId = await SeedSquadWithOwnerAsync(connectionString, ownerUserId);

            // Two admins issuing the same guest name concurrently. Different casing/whitespace that
            // normalises to the same key still collides (Requirement 3.1, 3.6).
            var first = new CreateGuestCommand(ownerUserId, squadId, "Dave", LawfulBasisAcknowledged: true);
            var second = new CreateGuestCommand(ownerUserId, squadId, "  dave ", LawfulBasisAcknowledged: true);

            OperationOutcome[] outcomes = await Task.WhenAll(
                RunCreateGuestAsync(connectionString, first),
                RunCreateGuestAsync(connectionString, second));

            // At most one may succeed (Requirement 3.6).
            Assert.Equal(1, outcomes.Count(o => o.Succeeded));

            // And the database holds exactly one guest row for that normalised name — the index, not
            // the change tracker, is the guard, since the two operations ran in separate contexts.
            await using var verify = CreateContext(connectionString);
            int rows = await verify.Set<SquadMembership>()
                .CountAsync(m => m.SquadId == squadId && m.DisplayNameNormalized == "dave");
            Assert.Equal(1, rows);
        });
    }

    // Requirement 11.9 — the filtered unique index on (squad_id, user_id) permits at most one of two
    // concurrent redemptions for the same user to create a membership; exactly one row exists.
    /// <summary>
    /// Two concurrent invite redemptions for the same user into one squad — each in its own scope,
    /// with distinct display names so only the user-uniqueness index can arbitrate — result in
    /// exactly one membership row for that user.
    /// </summary>
    [Fact]
    public async Task ConcurrentSameUserRedemptions_YieldExactlyOneRow()
    {
        await WithMigratedDatabaseAsync(async connectionString =>
        {
            var ownerUserId = Guid.CreateVersion7();
            Guid squadId = await SeedSquadWithOwnerAsync(connectionString, ownerUserId);
            string token = await SeedActiveInviteAsync(connectionString, squadId);

            var joiningUserId = Guid.CreateVersion7();

            // Distinct display names isolate the (squad_id, user_id) index as the sole arbiter: the
            // display-name index cannot be what rejects the loser.
            var first = new RedeemInviteCommand(joiningUserId, token, "Sam");
            var second = new RedeemInviteCommand(joiningUserId, token, "Samuel");

            OperationOutcome[] outcomes = await Task.WhenAll(
                RunRedeemInviteAsync(connectionString, first),
                RunRedeemInviteAsync(connectionString, second));

            // Both operations report success only when one is a fresh join and the other observes the
            // already-active membership; a genuine race instead rejects the loser with a duplicate
            // key. Either way, the user must end up with exactly one membership (Requirement 11.9).
            Assert.True(outcomes.Any(o => o.Succeeded), "Expected at least one redemption to succeed.");

            await using var verify = CreateContext(connectionString);
            int rows = await verify.Set<SquadMembership>()
                .CountAsync(m => m.SquadId == squadId && m.UserId == joiningUserId);
            Assert.Equal(1, rows);
        });
    }

    // Requirement 17.5 — once the clock reaches the purge instant, the squad and ALL of its
    // memberships are permanently removed. A full squad purge is total destruction (the squad and its
    // entire match history go together), so the anonymisation-over-deletion rule does not apply and no
    // membership is retained — the required squad_id foreign key means an anonymised membership could
    // not outlive its hard-deleted squad in any case.
    /// <summary>
    /// After advancing the clock past a soft-deleted squad's purge instant,
    /// <see cref="PurgeSquadHandler"/> permanently removes the squad and every one of its memberships,
    /// including those a history probe would report as carrying match history.
    /// </summary>
    [Fact]
    public async Task PurgeAfterClockAdvance_RemovesSquadAndAllMemberships()
    {
        await WithMigratedDatabaseAsync(async connectionString =>
        {
            var ownerUserId = Guid.CreateVersion7();
            var historyUserId = Guid.CreateVersion7();
            var noHistoryUserId = Guid.CreateVersion7();

            Guid squadId;
            Guid ownerMembershipId;
            Guid historyMembershipId;
            Guid noHistoryMembershipId;

            var purgeAt = FakeTimeProvider.DefaultNow.AddDays(30);

            // Seed a squad with three members: an owner, a member that stands in for a history-bearing
            // one, and a no-history member. A full purge removes them all regardless.
            await using (var seed = CreateContext(connectionString))
            {
                Squad squad = Squad.Create("Doomed Squad").Value!;
                SquadMembership owner = SquadMembership.CreateOwner(squad.Id, ownerUserId, "Owner").Value!;
                SquadMembership withHistory = SquadMembership.CreateRegistered(squad.Id, historyUserId, "Historian").Value!;
                SquadMembership noHistory = SquadMembership.CreateRegistered(squad.Id, noHistoryUserId, "Rookie").Value!;

                squadId = squad.Id;
                ownerMembershipId = owner.Id;
                historyMembershipId = withHistory.Id;
                noHistoryMembershipId = noHistory.Id;

                await new EfSquadRepository(seed).AddAsync(squad, CancellationToken.None);
                var members = new EfSquadMembershipRepository(seed);
                await members.AddAsync(owner, CancellationToken.None);
                await members.AddAsync(withHistory, CancellationToken.None);
                await members.AddAsync(noHistory, CancellationToken.None);
                await new UnitOfWork(seed).SaveChangesAsync(CancellationToken.None);
            }

            // Soft-delete the squad and set its purge instant, exactly as DeleteSquadHandler does:
            // MarkForDeletion sets PurgeAt and Remove is reinterpreted as a soft-delete by the save
            // pipeline. Memberships are retained (deletion is soft and not cascaded).
            await using (var delete = CreateContext(connectionString))
            {
                Squad squad = await delete.Set<Squad>().FirstAsync(s => s.Id == squadId);
                squad.MarkForDeletion(purgeAt);
                delete.Set<Squad>().Remove(squad);
                await new UnitOfWork(delete).SaveChangesAsync(CancellationToken.None);
            }

            // Advance the clock to the purge instant and run the purge.
            var clock = new FakeTimeProvider(purgeAt);

            await using (var purge = CreateContext(connectionString, clock))
            {
                var handler = new PurgeSquadHandler(
                    new EfSquadRepository(purge),
                    new EfSquadMembershipRepository(purge),
                    new UnitOfWork(purge),
                    clock);

                Result<int> result = await handler.HandleAsync(CancellationToken.None);

                Assert.True(result.IsSuccess, result.Error?.Message);
                Assert.Equal(1, result.Value);
            }

            await using var verify = CreateContext(connectionString);

            // The squad is permanently removed — gone even when the soft-delete filter is bypassed.
            bool squadExists = await verify.Set<Squad>()
                .IgnoreQueryFilters()
                .AnyAsync(s => s.Id == squadId);
            Assert.False(squadExists);

            // Every membership is permanently removed — none retained or anonymised.
            Assert.False(await verify.Set<SquadMembership>().AnyAsync(m => m.Id == ownerMembershipId));
            Assert.False(await verify.Set<SquadMembership>().AnyAsync(m => m.Id == historyMembershipId));
            Assert.False(await verify.Set<SquadMembership>().AnyAsync(m => m.Id == noHistoryMembershipId));
            Assert.Equal(0, await verify.Set<SquadMembership>().CountAsync(m => m.SquadId == squadId));
        });
    }

    /// <summary>
    /// Runs one <see cref="CreateGuestHandler"/> operation in its own scope (context + repositories +
    /// unit of work), capturing whether it succeeded or was rejected by a duplicate-key violation.
    /// </summary>
    private async Task<OperationOutcome> RunCreateGuestAsync(string connectionString, CreateGuestCommand command)
    {
        await using var context = CreateContext(connectionString);
        var handler = new CreateGuestHandler(
            new EfSquadRepository(context),
            new EfSquadMembershipRepository(context),
            new UnitOfWork(context),
            new FakeTimeProvider());

        try
        {
            Result<CreateGuestResult> result = await handler.HandleAsync(command, CancellationToken.None);
            return new OperationOutcome(result.IsSuccess);
        }
        catch (DuplicateKeyException)
        {
            // The database index rejected the concurrent insert (Requirement 3.6): a valid loss.
            return new OperationOutcome(false);
        }
    }

    /// <summary>
    /// Runs one <see cref="RedeemInviteHandler"/> operation in its own scope, capturing whether it
    /// succeeded or was rejected by a duplicate-key violation.
    /// </summary>
    private async Task<OperationOutcome> RunRedeemInviteAsync(string connectionString, RedeemInviteCommand command)
    {
        await using var context = CreateContext(connectionString);
        var handler = new RedeemInviteHandler(
            new EfInviteRepository(context),
            new EfSquadMembershipRepository(context),
            new EfUserRepository(context),
            new EfSquadRepository(context),
            new InviteSecretService(),
            new UnitOfWork(context),
            new FakeTimeProvider(),
            new NoOpNotificationPublisher(),
            NullLogger<RedeemInviteHandler>.Instance);

        try
        {
            Result<RedeemInviteResult> result = await handler.HandleAsync(command, CancellationToken.None);
            return new OperationOutcome(result.IsSuccess);
        }
        catch (DuplicateKeyException)
        {
            // The database index rejected the concurrent insert (Requirement 11.9): a valid loss.
            return new OperationOutcome(false);
        }
    }

    /// <summary>
    /// Seeds an active squad with a single active owner membership and returns the squad's identity,
    /// so the concurrency use cases have an authorised acting owner and a target squad.
    /// </summary>
    private async Task<Guid> SeedSquadWithOwnerAsync(string connectionString, Guid ownerUserId)
    {
        await using var seed = CreateContext(connectionString);

        Squad squad = Squad.Create("Test Squad").Value!;
        SquadMembership owner = SquadMembership.CreateOwner(squad.Id, ownerUserId, "Owner").Value!;

        await new EfSquadRepository(seed).AddAsync(squad, CancellationToken.None);
        await new EfSquadMembershipRepository(seed).AddAsync(owner, CancellationToken.None);
        await new UnitOfWork(seed).SaveChangesAsync(CancellationToken.None);

        return squad.Id;
    }

    /// <summary>
    /// Seeds an active, non-expiring-window invite for the squad and returns the redeemable token a
    /// client would present (the segment after <c>/join/</c>), which hashes to the stored token hash.
    /// </summary>
    private async Task<string> SeedActiveInviteAsync(string connectionString, Guid squadId)
    {
        var secrets = new InviteSecretService();
        InviteSecret secret = secrets.Generate();

        await using var seed = CreateContext(connectionString);
        Invite invite = Invite.Create(squadId, secret.TokenHash, FakeTimeProvider.DefaultNow.AddDays(30));
        await new EfInviteRepository(seed).AddAsync(invite, CancellationToken.None);
        await new UnitOfWork(seed).SaveChangesAsync(CancellationToken.None);

        int idx = secret.RedeemableLink.LastIndexOf(JoinLinkPrefix, StringComparison.Ordinal);
        return idx < 0 ? secret.RedeemableLink : secret.RedeemableLink[(idx + JoinLinkPrefix.Length)..];
    }

    /// <summary>
    /// Creates a production <see cref="PitchMateDbContext"/> bound to the throwaway database with a
    /// default fixed clock and no acting user.
    /// </summary>
    private static PitchMateDbContext CreateContext(string connectionString) =>
        CreateContext(connectionString, new FakeTimeProvider());

    /// <summary>
    /// Creates a production <see cref="PitchMateDbContext"/> bound to the throwaway database using the
    /// supplied clock so audit stamping and purge selection observe a controllable instant.
    /// </summary>
    private static PitchMateDbContext CreateContext(string connectionString, TimeProvider clock) =>
        new(
            MigrationTestSupport.BuildContextOptions(connectionString),
            clock,
            new FakeCurrentUserAccessor());

    /// <summary>
    /// Creates a uniquely-named empty database on the shared server, applies the production EF Core
    /// migrations to it (validating the squad migration too), runs the test body against a connection
    /// string targeting it, and drops it afterwards regardless of outcome.
    /// </summary>
    private async Task WithMigratedDatabaseAsync(Func<string, Task> body)
    {
        var databaseName = "squad_" + Guid.NewGuid().ToString("N");
        await MigrationTestSupport.CreateDatabaseAsync(_fixture.ConnectionString, databaseName);

        try
        {
            var connectionString =
                MigrationTestSupport.ConnectionStringForDatabase(_fixture.ConnectionString, databaseName);

            await using (var schema = CreateContext(connectionString))
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

    /// <summary>The outcome of one concurrent operation: whether it committed successfully.</summary>
    private readonly record struct OperationOutcome(bool Succeeded);
}

/// <summary>
/// A no-op <see cref="INotificationPublisher"/> for the concurrency integration tests: the
/// <see cref="RedeemInviteHandler"/> publishes a <c>MemberJoined</c> notification after a committed
/// join, but these tests assert only the database-enforced concurrency guarantees, so the publish is a
/// success that persists and emails nothing.
/// </summary>
internal sealed class NoOpNotificationPublisher : INotificationPublisher
{
    public Task<PitchMate.Domain.Notifications.Result> PublishAsync(
        PitchMate.Domain.Notifications.NotificationType type,
        Guid squadId,
        IReadOnlyCollection<Guid> directedTargetMembershipIds,
        NotificationContext context,
        CancellationToken cancellationToken) =>
        Task.FromResult(PitchMate.Domain.Notifications.Result.Ok());
}
