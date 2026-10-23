using Microsoft.EntityFrameworkCore;
using PitchMate.Application.Common.Persistence;
using PitchMate.Domain.Squads;
using PitchMate.Infrastructure.Persistence;
using PitchMate.Infrastructure.Squads.Repositories;
using PitchMate.Infrastructure.Tests.Persistence;

namespace PitchMate.Infrastructure.Tests.Squads;

/// <summary>
/// <see cref="EfGuestClaimRepository"/> against real PostgreSQL, for the claim-link lookups (ADR 0003):
/// a claim is found by its link secret's hash in any state; the hash is unique, so two claims can't
/// share one; the latest completed claim is what a reversal finds (a completed claim is not "open");
/// and a squad's open claims include issued and accepted ones, and none from another squad.
/// </summary>
[Collection(PostgreSqlCollection.Name)]
public sealed class GuestClaimRepositoryIntegrationTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 23, 9, 30, 0, TimeSpan.Zero);

    private readonly PostgreSqlContainerFixture _fixture;

    public GuestClaimRepositoryIntegrationTests(PostgreSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    [Fact]
    public async Task FindsByHash_KeepsHashesUnique_AndSeparatesOpenFromCompleted()
    {
        await WithMigratedDatabaseAsync(async connectionString =>
        {
            (Guid squadId, Guid guestId) = await SeedSquadWithGuestAsync(connectionString, "Ours");
            (_, Guid otherGuestId) = await SeedSquadWithGuestAsync(connectionString, "Theirs");

            // An issued claim, an accepted claim, and a completed claim on our guest; one issued claim on
            // the other squad's guest.
            var playerId = Guid.CreateVersion7();
            await using (PitchMateDbContext write = CreateContext(connectionString))
            {
                var claims = new EfGuestClaimRepository(write);
                GuestClaim completed = Issue(guestId, "hash-completed");
                Assert.True(completed.Accept(playerId, Now).IsSuccess);
                Assert.True(completed.MarkCompleted(Now).IsSuccess);
                GuestClaim accepted = Issue(guestId, "hash-accepted");
                Assert.True(accepted.Accept(Guid.CreateVersion7(), Now).IsSuccess);
                await claims.AddAsync(completed, CancellationToken.None);
                await claims.AddAsync(accepted, CancellationToken.None);
                await claims.AddAsync(Issue(otherGuestId, "hash-elsewhere"), CancellationToken.None);
                await new UnitOfWork(write).SaveChangesAsync(CancellationToken.None);
            }

            await using (PitchMateDbContext read = CreateContext(connectionString))
            {
                var claims = new EfGuestClaimRepository(read);

                GuestClaim? byHash = await claims.FindByTokenHashAsync("hash-completed", CancellationToken.None);
                Assert.NotNull(byHash);
                Assert.Equal(GuestClaimState.Completed, byHash.State);
                Assert.Equal(playerId, byHash.TargetUserId);
                Assert.Null(await claims.FindByTokenHashAsync("hash-nobody-was-given", CancellationToken.None));

                GuestClaim? latestCompleted =
                    await claims.GetLatestCompletedForMembershipAsync(guestId, CancellationToken.None);
                Assert.Equal(byHash.Id, latestCompleted?.Id);

                GuestClaim? open = await claims.GetOpenForMembershipAsync(guestId, CancellationToken.None);
                Assert.Equal(GuestClaimState.Consented, open?.State);

                IReadOnlyList<GuestClaim> openForSquad =
                    await claims.ListOpenForSquadAsync(squadId, CancellationToken.None);
                Assert.Equal(GuestClaimState.Consented, Assert.Single(openForSquad).State);
            }

            // The hash index is unique: a second claim with the same hash is refused by the database, which
            // the unit of work reports as a duplicate key.
            await using (PitchMateDbContext duplicate = CreateContext(connectionString))
            {
                await new EfGuestClaimRepository(duplicate).AddAsync(
                    Issue(guestId, "hash-accepted"), CancellationToken.None);
                await Assert.ThrowsAsync<DuplicateKeyException>(
                    () => new UnitOfWork(duplicate).SaveChangesAsync(CancellationToken.None));
            }
        });
    }

    private static GuestClaim Issue(Guid membershipId, string tokenHash) =>
        GuestClaim.Initiate(membershipId, tokenHash, Now + GuestClaim.LinkValidity);

    /// <summary>Seeds a squad with an owner and one guest, returning both identities.</summary>
    private static async Task<(Guid SquadId, Guid GuestId)> SeedSquadWithGuestAsync(
        string connectionString,
        string name)
    {
        await using PitchMateDbContext seed = CreateContext(connectionString);

        Squad squad = Squad.Create(name).Value!;
        SquadMembership guest = SquadMembership.CreateGuest(squad.Id, "Guest", skillTier: null, Now).Value!;
        var memberships = new EfSquadMembershipRepository(seed);
        await new EfSquadRepository(seed).AddAsync(squad, CancellationToken.None);
        await memberships.AddAsync(
            SquadMembership.CreateOwner(squad.Id, Guid.CreateVersion7(), "Owner").Value!, CancellationToken.None);
        await memberships.AddAsync(guest, CancellationToken.None);
        await new UnitOfWork(seed).SaveChangesAsync(CancellationToken.None);

        return (squad.Id, guest.Id);
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
        var databaseName = "guest_claim_" + Guid.NewGuid().ToString("N");
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
