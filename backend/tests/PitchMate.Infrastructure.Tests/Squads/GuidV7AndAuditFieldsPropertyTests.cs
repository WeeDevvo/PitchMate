using FsCheck;
using FsCheck.Xunit;
using Microsoft.EntityFrameworkCore;
using PitchMate.Application.Common;
using PitchMate.Domain.Common;
using PitchMate.Domain.Squads;
using PitchMate.Infrastructure.Persistence;
using PitchMate.Infrastructure.Squads.Repositories;
using PitchMate.Infrastructure.Tests.Generators;
using PitchMate.Infrastructure.Tests.Persistence;

namespace PitchMate.Infrastructure.Tests.Squads;

// Feature: squads-and-membership, Property 41: Persisted records carry a GUID v7 identity and audit fields

/// <summary>
/// Property test for design Property 41: for any created <see cref="Squad"/>,
/// <see cref="SquadMembership"/>, or <see cref="Invite"/> persisted through the squad repositories,
/// the production <see cref="PitchMateDbContext"/> save pipeline, and a committed
/// <see cref="UnitOfWork"/>, the stored row carries a non-zero UUID <b>version 7</b> primary key and
/// the audit fields supplied by <see cref="BaseEntity"/> (<c>CreatedAt</c>/<c>UpdatedAt</c> stamped
/// from the clock, <c>CreatedBy</c>/<c>UpdatedBy</c> from the current-user accessor).
/// <para>
/// Per the coding standards, this Infrastructure test runs against a <em>real</em> PostgreSQL
/// instance via the shared Testcontainers fixture — never the EF in-memory provider or SQLite — and
/// the squad EF migration (task 18.4) is applied to a dedicated throwaway database so the rows are
/// written against the real, migrated schema (<c>uuid</c> keys, <c>timestamptz</c> audit columns,
/// and the squad constraints/indexes). Running it therefore requires Docker to be available.
/// </para>
/// <para>
/// Determinism comes from the controllable <see cref="FakeTimeProvider"/> and
/// <see cref="FakeCurrentUserAccessor"/>: each iteration fixes the clock instant and acting user,
/// persists a squad plus an owner membership, a guest membership, and an invite, then reloads each
/// row in a fresh context to assert the identity and audit fields written to the database.
/// FsCheck's property model is synchronous, so each iteration's asynchronous database work is
/// bridged with <see cref="RunAsync"/> (a deliberate, deadlock-free block in a test-only context
/// with no synchronization context).
/// </para>
/// <para>**Validates: Requirements 19.5**</para>
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class GuidV7AndAuditFieldsPropertyTests
{
    private readonly PostgreSqlContainerFixture _fixture;

    // A dedicated, migrated throwaway database, created and migrated exactly once on first use.
    // Lazy one-time async setup is used deliberately instead of xUnit's IAsyncLifetime: FsCheck.Xunit's
    // property runner does not honour class-level InitializeAsync, so the schema is prepared here and
    // awaited by every iteration (cheap after the first). The database lives on the shared throwaway
    // container and is discarded when the container is disposed at collection teardown.
    private readonly Lazy<Task<string>> _migratedConnectionString;

    /// <summary>Receives the shared PostgreSQL container fixture from the collection.</summary>
    /// <param name="fixture">The shared, container-backed persistence fixture.</param>
    public GuidV7AndAuditFieldsPropertyTests(PostgreSqlContainerFixture fixture)
    {
        _fixture = fixture;
        _migratedConnectionString = new Lazy<Task<string>>(CreateAndMigrateDatabaseAsync);
    }

    /// <summary>
    /// Creates a uniquely-named database on the shared server and applies the production EF
    /// migrations (including the squad migration from task 18.4) so rows are persisted against the
    /// real, migrated schema. Returns the connection string targeting that database.
    /// </summary>
    private async Task<string> CreateAndMigrateDatabaseAsync()
    {
        var databaseName = "sq_guidv7_" + Guid.NewGuid().ToString("N");
        await MigrationTestSupport.CreateDatabaseAsync(_fixture.ConnectionString, databaseName);
        var connectionString = MigrationTestSupport.ConnectionStringForDatabase(_fixture.ConnectionString, databaseName);

        await using var context = new PitchMateDbContext(
            MigrationTestSupport.BuildContextOptions(connectionString),
            new FakeTimeProvider(),
            new FakeCurrentUserAccessor());
        await context.Database.MigrateAsync();

        return connectionString;
    }

    /// <summary>
    /// **Validates: Requirements 19.5** — every squad entity type (<see cref="Squad"/>,
    /// <see cref="SquadMembership"/>, <see cref="Invite"/>) persisted through the repositories and a
    /// committed unit of work is stored with a non-zero UUID version 7 identity and with its
    /// <c>CreatedAt</c>/<c>UpdatedAt</c> equal to the clock instant and its
    /// <c>CreatedBy</c>/<c>UpdatedBy</c> equal to the current actor.
    /// </summary>
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(PersistedSquadAuditArbitraries) })]
    public Property PersistedSquadRecordsCarryGuidV7IdentityAndAuditFields(PersistedSquadAuditInput input)
    {
        return RunAsync(async () =>
        {
            var connectionString = await _migratedConnectionString.Value;
            var clock = new FakeTimeProvider(input.ClockNow);
            var actor = new FakeCurrentUserAccessor(input.Actor);

            // Distinct, valid display names within the one squad (the (squad_id,
            // display_name_normalized) unique index rejects a collision), and a guaranteed-unique
            // token hash for the invite's unique token_hash index.
            var ownerName = "o-" + input.OwnerName;
            var guestName = "g-" + input.GuestName;
            var tokenHash = "hash-" + Guid.NewGuid().ToString("N");

            Guid squadId, ownerId, guestId, inviteId;
            await using (var context = CreateContext(connectionString, clock, actor))
            {
                var squads = new EfSquadRepository(context);
                var memberships = new EfSquadMembershipRepository(context);
                var invites = new EfInviteRepository(context);
                var unitOfWork = new UnitOfWork(context);

                var squad = Squad.Create(input.SquadName).Value!;
                await squads.AddAsync(squad, CancellationToken.None);

                var owner = SquadMembership.CreateOwner(squad.Id, input.OwnerUserId, ownerName).Value!;
                var guest = SquadMembership.CreateGuest(squad.Id, guestName, skillTier: null, input.ClockNow).Value!;
                await memberships.AddAsync(owner, CancellationToken.None);
                await memberships.AddAsync(guest, CancellationToken.None);

                var invite = Invite.Create(squad.Id, tokenHash, input.ClockNow.AddDays(7));
                await invites.AddAsync(invite, CancellationToken.None);

                await unitOfWork.SaveChangesAsync(CancellationToken.None);

                squadId = squad.Id;
                ownerId = owner.Id;
                guestId = guest.Id;
                inviteId = invite.Id;
            }

            await using var verify = CreateContext(connectionString, new FakeTimeProvider(), new FakeCurrentUserAccessor());
            var storedSquad = await verify.Set<Squad>().FirstOrDefaultAsync(s => s.Id == squadId);
            var storedOwner = await verify.Set<SquadMembership>().FirstOrDefaultAsync(m => m.Id == ownerId);
            var storedGuest = await verify.Set<SquadMembership>().FirstOrDefaultAsync(m => m.Id == guestId);
            var storedInvite = await verify.Set<Invite>().FirstOrDefaultAsync(i => i.Id == inviteId);

            BaseEntity?[] persisted = [storedSquad, storedOwner, storedGuest, storedInvite];
            return persisted.All(entity => CarriesGuidV7AndAuditFields(entity, input.ClockNow, input.Actor));
        });
    }

    /// <summary>
    /// Confirms a reloaded row carries a non-zero UUID version 7 identity and the audit fields the
    /// save pipeline must stamp: both timestamps equal the clock instant and both actor identifiers
    /// equal the current actor.
    /// </summary>
    private static bool CarriesGuidV7AndAuditFields(BaseEntity? entity, DateTimeOffset now, string actor) =>
        entity is not null
        && entity.Id != Guid.Empty
        && entity.Id.Version == 7
        && entity.CreatedAt == now
        && entity.UpdatedAt == now
        && entity.CreatedBy == actor
        && entity.UpdatedBy == actor;

    /// <summary>
    /// Builds a production <see cref="PitchMateDbContext"/> bound to the dedicated migrated database,
    /// using the same Npgsql + snake_case naming convention as production so mapping and stamping
    /// behaviour under test match production exactly.
    /// </summary>
    private static PitchMateDbContext CreateContext(
        string connectionString, TimeProvider clock, ICurrentUserAccessor currentUser) =>
        new(MigrationTestSupport.BuildContextOptions(connectionString), clock, currentUser);

    /// <summary>
    /// Bridges FsCheck's synchronous property model to each iteration's asynchronous database work.
    /// Blocking here is safe: xUnit test execution has no synchronization context, so
    /// <c>GetAwaiter().GetResult()</c> cannot deadlock and surfaces the original exception unwrapped.
    /// </summary>
    private static Property RunAsync(Func<Task<bool>> body) =>
        body().GetAwaiter().GetResult().ToProperty();
}
