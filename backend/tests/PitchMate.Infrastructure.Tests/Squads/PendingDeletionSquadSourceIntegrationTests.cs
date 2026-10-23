using Microsoft.EntityFrameworkCore;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Squads;
using PitchMate.Infrastructure.Persistence;
using PitchMate.Infrastructure.Squads.Queries;
using PitchMate.Infrastructure.Squads.Repositories;
using PitchMate.Infrastructure.Tests.Persistence;

namespace PitchMate.Infrastructure.Tests.Squads;

/// <summary>
/// <see cref="EfPendingDeletionSquadSource"/> against real PostgreSQL (Requirement 17.4): it lists a
/// user's squads only where that user is the active owner, only while the squad is deleted with its
/// purge instant still ahead, soonest purge first, and it tells any other user nothing at all. The
/// soft-delete filter is bypassed for this read, so these cases are what keep it from leaking a
/// deleted squad to its former members.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class PendingDeletionSquadSourceIntegrationTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 23, 9, 30, 0, TimeSpan.Zero);

    private readonly PostgreSqlContainerFixture _fixture;

    public PendingDeletionSquadSourceIntegrationTests(PostgreSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [Fact]
    public async Task ListsOnlyTheOwnersRestorableSquads_SoonestPurgeFirst()
    {
        await WithMigratedDatabaseAsync(async connectionString =>
        {
            var owner = Guid.CreateVersion7();
            var otherOwner = Guid.CreateVersion7();
            var member = Guid.CreateVersion7();

            // Restorable, owned by `owner`: purged in 5 days and in 1 day.
            Guid later = await SeedSquadAsync(connectionString, "Later", owner, member);
            Guid sooner = await SeedSquadAsync(connectionString, "Sooner", owner, member);
            await SoftDeleteAsync(connectionString, later, Now.AddDays(5));
            await SoftDeleteAsync(connectionString, sooner, Now.AddDays(1));

            // Not deleted: hidden from this read (the ordinary list shows it).
            await SeedSquadAsync(connectionString, "Live", owner, member);

            // Deleted, but `owner` is only an admin there.
            Guid notTheirs = await SeedSquadAsync(connectionString, "Not theirs", otherOwner, owner);
            await PromoteAsync(connectionString, notTheirs, owner);
            await SoftDeleteAsync(connectionString, notTheirs, Now.AddDays(2));

            // Deleted with its purge already due: no longer restorable.
            Guid due = await SeedSquadAsync(connectionString, "Due", owner, member);
            await SoftDeleteAsync(connectionString, due, Now.AddMinutes(-1));

            await using PitchMateDbContext read = CreateContext(connectionString);
            var source = new EfPendingDeletionSquadSource(read);

            IReadOnlyList<PendingDeletionSquad> listed =
                await source.ListOwnedByAsync(owner, Now, CancellationToken.None);

            Assert.Equal(
                [
                    new PendingDeletionSquad(sooner, "Sooner", Now.AddDays(1)),
                    new PendingDeletionSquad(later, "Later", Now.AddDays(5)),
                ],
                listed);

            // A member of the same deleted squads learns nothing; the other owner sees only their own.
            Assert.Empty(await source.ListOwnedByAsync(member, Now, CancellationToken.None));
            PendingDeletionSquad onlyTheirs =
                Assert.Single(await source.ListOwnedByAsync(otherOwner, Now, CancellationToken.None));
            Assert.Equal(notTheirs, onlyTheirs.SquadId);
        });
    }

    [Fact]
    public async Task ListsNothingOnceTheSquadIsRestored()
    {
        await WithMigratedDatabaseAsync(async connectionString =>
        {
            var owner = Guid.CreateVersion7();
            Guid squadId = await SeedSquadAsync(connectionString, "Back again", owner, Guid.CreateVersion7());
            await SoftDeleteAsync(connectionString, squadId, Now.AddDays(30));

            await using (PitchMateDbContext restore = CreateContext(connectionString))
            {
                Squad squad = await restore.Set<Squad>().IgnoreQueryFilters().FirstAsync(s => s.Id == squadId);
                squad.CancelDeletion();
                new EfRepository<Squad>(restore).Restore(squad);
                await new UnitOfWork(restore).SaveChangesAsync(CancellationToken.None);
            }

            await using PitchMateDbContext read = CreateContext(connectionString);
            Assert.Empty(await new EfPendingDeletionSquadSource(read)
                .ListOwnedByAsync(owner, Now, CancellationToken.None));
        });
    }

    /// <summary>Seeds a squad with an active owner and one active registered member.</summary>
    private static async Task<Guid> SeedSquadAsync(
        string connectionString,
        string name,
        Guid ownerUserId,
        Guid memberUserId)
    {
        await using PitchMateDbContext seed = CreateContext(connectionString);

        Squad squad = Squad.Create(name).Value!;
        var memberships = new EfSquadMembershipRepository(seed);
        await new EfSquadRepository(seed).AddAsync(squad, CancellationToken.None);
        await memberships.AddAsync(
            SquadMembership.CreateOwner(squad.Id, ownerUserId, "Owner").Value!, CancellationToken.None);
        await memberships.AddAsync(
            SquadMembership.CreateRegistered(squad.Id, memberUserId, "Member").Value!, CancellationToken.None);
        await new UnitOfWork(seed).SaveChangesAsync(CancellationToken.None);

        return squad.Id;
    }

    /// <summary>Promotes a user's membership in a squad to admin.</summary>
    private static async Task PromoteAsync(string connectionString, Guid squadId, Guid userId)
    {
        await using PitchMateDbContext promote = CreateContext(connectionString);
        SquadMembership membership = await promote.Set<SquadMembership>()
            .FirstAsync(m => m.SquadId == squadId && m.UserId == userId);
        Assert.True(membership.PromoteToAdmin().IsSuccess);
        await new UnitOfWork(promote).SaveChangesAsync(CancellationToken.None);
    }

    /// <summary>Soft-deletes a squad with the given purge instant, as <c>DeleteSquadHandler</c> does.</summary>
    private static async Task SoftDeleteAsync(string connectionString, Guid squadId, DateTimeOffset purgeAt)
    {
        await using PitchMateDbContext delete = CreateContext(connectionString);
        Squad squad = await delete.Set<Squad>().FirstAsync(s => s.Id == squadId);
        squad.MarkForDeletion(purgeAt);
        delete.Set<Squad>().Remove(squad);
        await new UnitOfWork(delete).SaveChangesAsync(CancellationToken.None);
    }

    private static PitchMateDbContext CreateContext(string connectionString) =>
        new(
            MigrationTestSupport.BuildContextOptions(connectionString),
            new FakeTimeProvider(Now),
            new FakeCurrentUserAccessor());

    /// <summary>
    /// Runs the body against a uniquely-named, freshly migrated database on the shared server and drops
    /// it afterwards, whatever the outcome.
    /// </summary>
    private async Task WithMigratedDatabaseAsync(Func<string, Task> body)
    {
        var databaseName = "pending_deletion_" + Guid.NewGuid().ToString("N");
        await MigrationTestSupport.CreateDatabaseAsync(_fixture.ConnectionString, databaseName);

        try
        {
            var connectionString =
                MigrationTestSupport.ConnectionStringForDatabase(_fixture.ConnectionString, databaseName);

            await using (PitchMateDbContext schema = CreateContext(connectionString))
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
