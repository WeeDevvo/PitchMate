using Microsoft.EntityFrameworkCore;
using Npgsql;
using PitchMate.Application.Notifications;
using PitchMate.Domain.Auth;
using PitchMate.Domain.Common;
using PitchMate.Domain.Notifications;
using PitchMate.Domain.Squads;
using PitchMate.Infrastructure.Auth.Repositories;
using PitchMate.Infrastructure.Notifications;
using PitchMate.Infrastructure.Persistence;
using PitchMate.Infrastructure.Squads.Repositories;
using PitchMate.Infrastructure.Tests.Persistence;

namespace PitchMate.Infrastructure.Tests.Notifications;

/// <summary>
/// Integration tests for the notification persistence layer, exercised against a <em>real</em>
/// PostgreSQL instance via the shared Testcontainers fixture with the production EF Core migrations
/// applied — never the EF in-memory provider or SQLite, so they observe actual PostgreSQL
/// <c>uuid</c>/<c>timestamptz</c> ordering, enum-as-int storage, filtered-index, and hard-delete
/// semantics (per coding-standards: "run against real PostgreSQL via Testcontainers, and apply EF
/// migrations against the container"). Each test runs against its own freshly created, migrated
/// database on the shared server, so it is isolated from every other test.
/// <para>
/// The tests confirm four persistence guarantees for <see cref="InAppNotification"/> and
/// <see cref="EfNotificationRepository"/>:
/// </para>
/// <list type="number">
/// <item>Round-trip persistence: the <see cref="NotificationType"/> and <see cref="ReadState"/>
/// enum-as-int mapping, the 200/2000 title/body length mapping, and the
/// <see cref="BaseEntity"/> audit fields all survive a save + reload (Requirements 12.6, 12.7,
/// 12.8).</item>
/// <item>Recipient-ordered list: <see cref="EfNotificationRepository.ListForUserAsync"/> returns the
/// caller's own records ordered by <c>CreatedAt</c> descending then <c>Id</c> descending (a stable
/// total order served by <c>ix_in_app_notification_recipient_created</c>), enforcing own-records-only
/// and squad scope (Requirements 9.1, 12.7).</item>
/// <item>Filtered unread count: <see cref="EfNotificationRepository.CountUnreadForUserAsync"/> returns
/// exactly the caller's own <see cref="ReadState.Unread"/> records, served by the filtered
/// <c>ix_in_app_notification_recipient_unread</c> index (Requirements 9.3, 12.8).</item>
/// <item>Lifecycle hard-deletes: each removal deletes exactly the targeted rows and leaves the rest
/// intact — a genuine hard-delete, proven by querying with <see cref="EntityFrameworkQueryableExtensions.IgnoreQueryFilters{TEntity}"/>
/// so a soft-delete could not merely hide the row (Requirements 11.1, 11.2, 11.3).</item>
/// </list>
/// <para>Validates: Requirements 9.1, 9.3, 11.1, 11.2, 11.3, 12.6, 12.7, 12.8.</para>
/// </summary>
[Collection(PostgreSqlCollection.Name)]
[Trait("Feature", "notifications")]
public sealed class NotificationPersistenceIntegrationTests
{
    private const string RecipientCreatedIndex = "ix_in_app_notification_recipient_created";
    private const string RecipientUnreadIndex = "ix_in_app_notification_recipient_unread";

    private readonly PostgreSqlContainerFixture _fixture;

    /// <summary>Receives the shared PostgreSQL container fixture from the collection.</summary>
    /// <param name="fixture">The shared, container-backed persistence fixture.</param>
    public NotificationPersistenceIntegrationTests(PostgreSqlContainerFixture fixture)
    {
        _fixture = fixture;
    }

    // Requirements 12.6, 12.7, 12.8 — the entity configuration and migration map the enums as ints,
    // the title/body length constraints, and the BaseEntity audit fields; all of it survives a
    // save + reload against real PostgreSQL, and the raw columns confirm the enum-as-int storage.
    /// <summary>
    /// A persisted <see cref="InAppNotification"/> round-trips: on reload its
    /// <see cref="NotificationType"/> and <see cref="ReadState"/> enums, its maximum-length title and
    /// body, and its <see cref="BaseEntity"/> audit fields (created/updated instants stamped from the
    /// clock) match what was saved, and the raw <c>type</c>/<c>read_state</c> columns hold the enums'
    /// integer values.
    /// </summary>
    [Fact]
    public async Task RoundTrip_PersistsEnumsLengthsAndAuditFields()
    {
        await WithMigratedDatabaseAsync(async connectionString =>
        {
            Guid squadId = await SeedSquadAsync(connectionString, "Round Trip FC");
            (Guid _, Guid membershipId) =
                await SeedRegisteredMemberAsync(connectionString, squadId, "Alex", "alex@example.com");

            // Maximum-length title (200) and body (2000) exercise the varchar length mapping.
            string title = new string('t', InAppNotification.TitleMaxLength);
            string body = new string('b', InAppNotification.BodyMaxLength);
            var createdAt = FakeTimeProvider.DefaultNow;

            InAppNotification notification =
                InAppNotification.Create(squadId, membershipId, NotificationType.OwnershipTransferred, title, body).Value!;
            Guid notificationId = notification.Id;

            var clock = new FakeTimeProvider(createdAt);
            await using (var write = CreateContext(connectionString, clock))
            {
                await new EfNotificationRepository(write).AddAsync(notification, CancellationToken.None);
                await new UnitOfWork(write).SaveChangesAsync(CancellationToken.None);
            }

            // Reload through the model: the entity round-trips field-for-field.
            await using (var verify = CreateContext(connectionString))
            {
                InAppNotification reloaded =
                    await verify.Set<InAppNotification>().FirstAsync(n => n.Id == notificationId);

                Assert.Equal(squadId, reloaded.SquadId);
                Assert.Equal(membershipId, reloaded.RecipientMembershipId);
                Assert.Equal(NotificationType.OwnershipTransferred, reloaded.Type);
                Assert.Equal(ReadState.Unread, reloaded.ReadState);
                Assert.Equal(title, reloaded.Title);
                Assert.Equal(InAppNotification.TitleMaxLength, reloaded.Title.Length);
                Assert.Equal(body, reloaded.Body);
                Assert.Equal(InAppNotification.BodyMaxLength, reloaded.Body.Length);

                // BaseEntity audit fields are stamped from the clock on create.
                Assert.Equal(createdAt, reloaded.CreatedAt);
                Assert.Equal(createdAt, reloaded.UpdatedAt);
            }

            // The raw columns prove the enum-as-int mapping: type = OwnershipTransferred (3),
            // read_state = Unread (0).
            (int rawType, int rawReadState) = await ReadEnumColumnsAsync(connectionString, notificationId);
            Assert.Equal((int)NotificationType.OwnershipTransferred, rawType);
            Assert.Equal((int)ReadState.Unread, rawReadState);
        });
    }

    // Requirements 9.1, 12.7 — ListForUserAsync returns only the caller's own records, ordered by
    // CreatedAt desc then Id desc (a stable total order matching PostgreSQL uuid ordering), served by
    // ix_in_app_notification_recipient_created; own-records-only and squad scope are enforced in the DB.
    /// <summary>
    /// <see cref="EfNotificationRepository.ListForUserAsync"/> returns exactly the caller's own
    /// records in a stable most-recent-first total order (creation instant descending, GUID v7
    /// identity descending as the tie-break, including a same-instant pair), never another user's
    /// records, and honours an optional single-squad scope. The supporting recipient/created index
    /// exists in the migrated schema.
    /// </summary>
    [Fact]
    public async Task ListForUser_ReturnsOwnRecordsInStableOrder_AndHonoursSquadScope()
    {
        await WithMigratedDatabaseAsync(async connectionString =>
        {
            // Two squads. The caller (Alex) is a member of both; Blair is a member of squad one only.
            Guid squadOne = await SeedSquadAsync(connectionString, "Squad One");
            Guid squadTwo = await SeedSquadAsync(connectionString, "Squad Two");

            (Guid alexUserId, Guid alexInSquadOne) =
                await SeedRegisteredMemberAsync(connectionString, squadOne, "Alex", "alex@example.com");
            (Guid blairUserId, Guid blairInSquadOne) =
                await SeedRegisteredMemberAsync(connectionString, squadOne, "Blair", "blair@example.com");
            // A guest in squad one proves registered-only seeding; guests are never recipients.
            await SeedGuestAsync(connectionString, squadOne, "Guest");

            // Alex's second membership is backed by the same user, in the other squad.
            Guid alexInSquadTwo =
                await SeedMembershipForUserAsync(connectionString, squadTwo, alexUserId, "Alex");

            var baseInstant = FakeTimeProvider.DefaultNow;

            // Alex's squad-one records: three distinct instants, the last instant carrying two records
            // (a same-CreatedAt pair) so the Id desc tie-break is exercised.
            var recorded = new List<Recorded>();
            recorded.Add(new Recorded(
                await AddNotificationAsync(connectionString, baseInstant, squadOne, alexInSquadOne, NotificationType.MemberJoined),
                baseInstant));
            recorded.Add(new Recorded(
                await AddNotificationAsync(connectionString, baseInstant.AddMinutes(1), squadOne, alexInSquadOne, NotificationType.PromotedToAdmin),
                baseInstant.AddMinutes(1)));

            var sameInstant = baseInstant.AddMinutes(2);
            (Guid firstOfPair, Guid secondOfPair) =
                await AddTwoNotificationsAsync(connectionString, sameInstant, squadOne, alexInSquadOne);
            recorded.Add(new Recorded(firstOfPair, sameInstant));
            recorded.Add(new Recorded(secondOfPair, sameInstant));

            // A squad-two record for Alex (in scope only for an unscoped or squad-two query).
            Guid alexSquadTwoNotification =
                await AddNotificationAsync(connectionString, baseInstant.AddMinutes(3), squadTwo, alexInSquadTwo, NotificationType.MemberJoined);

            // Blair's record must never surface in Alex's queries.
            Guid blairNotification =
                await AddNotificationAsync(connectionString, baseInstant.AddMinutes(1), squadOne, blairInSquadOne, NotificationType.MemberJoined);

            await using var verify = CreateContext(connectionString);
            var repository = new EfNotificationRepository(verify);

            // Unscoped: Alex sees exactly their own five records (four in squad one, one in squad two),
            // none of Blair's.
            IReadOnlyList<InAppNotification> unscoped =
                await repository.ListForUserAsync(alexUserId, squadId: null, limit: 200, CancellationToken.None);

            Assert.Equal(5, unscoped.Count);
            Assert.DoesNotContain(unscoped, n => n.Id == blairNotification);

            List<Guid> expectedUnscoped = recorded
                .Append(new Recorded(alexSquadTwoNotification, baseInstant.AddMinutes(3)))
                .OrderByDescending(r => r.CreatedAt)
                .ThenByDescending(r => r.Id, UuidV7Comparer.Instance)
                .Select(r => r.Id)
                .ToList();
            Assert.Equal(expectedUnscoped, unscoped.Select(n => n.Id).ToList());

            // Squad-scoped to squad one: exactly the four squad-one records, still in stable order,
            // and the squad-two record is excluded.
            IReadOnlyList<InAppNotification> scoped =
                await repository.ListForUserAsync(alexUserId, squadOne, limit: 200, CancellationToken.None);

            Assert.Equal(4, scoped.Count);
            Assert.All(scoped, n => Assert.Equal(squadOne, n.SquadId));
            Assert.All(scoped, n => Assert.Equal(alexInSquadOne, n.RecipientMembershipId));
            Assert.DoesNotContain(scoped, n => n.Id == alexSquadTwoNotification);

            List<Guid> expectedScoped = recorded
                .OrderByDescending(r => r.CreatedAt)
                .ThenByDescending(r => r.Id, UuidV7Comparer.Instance)
                .Select(r => r.Id)
                .ToList();
            Assert.Equal(expectedScoped, scoped.Select(n => n.Id).ToList());

            // Blair sees only their own single record — own-records-only is enforced both ways.
            IReadOnlyList<InAppNotification> blairList =
                await repository.ListForUserAsync(blairUserId, squadId: null, limit: 200, CancellationToken.None);
            Assert.Equal(new[] { blairNotification }, blairList.Select(n => n.Id).ToArray());

            // The supporting recipient/created index is present in the migrated schema.
            Assert.True(await MigrationTestSupport.IndexExistsAsync(connectionString, RecipientCreatedIndex));
        });
    }

    // Requirements 9.3, 12.8 — CountUnreadForUserAsync returns exactly the caller's own Unread records
    // (optionally squad-scoped), never another user's, served by the filtered
    // ix_in_app_notification_recipient_unread index.
    /// <summary>
    /// <see cref="EfNotificationRepository.CountUnreadForUserAsync"/> returns the exact number of the
    /// caller's own <see cref="ReadState.Unread"/> records — read records and other users' records are
    /// excluded — and the filtered unread index exists in the migrated schema.
    /// </summary>
    [Fact]
    public async Task CountUnreadForUser_CountsOnlyOwnUnread_ServedByFilteredIndex()
    {
        await WithMigratedDatabaseAsync(async connectionString =>
        {
            Guid squadId = await SeedSquadAsync(connectionString, "Counting FC");
            (Guid alexUserId, Guid alexMembership) =
                await SeedRegisteredMemberAsync(connectionString, squadId, "Alex", "alex@example.com");
            (Guid _, Guid blairMembership) =
                await SeedRegisteredMemberAsync(connectionString, squadId, "Blair", "blair@example.com");

            var baseInstant = FakeTimeProvider.DefaultNow;

            // Alex: three notifications, of which one is later marked read (leaving two Unread).
            Guid alexUnreadOne =
                await AddNotificationAsync(connectionString, baseInstant, squadId, alexMembership, NotificationType.MemberJoined);
            await AddNotificationAsync(connectionString, baseInstant.AddMinutes(1), squadId, alexMembership, NotificationType.PromotedToAdmin);
            await AddNotificationAsync(connectionString, baseInstant.AddMinutes(2), squadId, alexMembership, NotificationType.RemovedFromSquad);
            await MarkReadAsync(connectionString, alexUnreadOne);

            // Blair: one Unread record that must not be counted for Alex.
            await AddNotificationAsync(connectionString, baseInstant, squadId, blairMembership, NotificationType.MemberJoined);

            await using var verify = CreateContext(connectionString);
            var repository = new EfNotificationRepository(verify);

            int alexUnread =
                await repository.CountUnreadForUserAsync(alexUserId, squadId: null, CancellationToken.None);
            Assert.Equal(2, alexUnread);

            int alexUnreadScoped =
                await repository.CountUnreadForUserAsync(alexUserId, squadId, CancellationToken.None);
            Assert.Equal(2, alexUnreadScoped);

            // The supporting filtered unread index is present in the migrated schema.
            Assert.True(await MigrationTestSupport.IndexExistsAsync(connectionString, RecipientUnreadIndex));
        });
    }

    // Requirement 11.1 — RemoveForUserAsync hard-deletes every notification whose recipient membership
    // is backed by the erased user, across all squads, and leaves every other user's records intact.
    /// <summary>
    /// <see cref="EfNotificationRepository.RemoveForUserAsync"/> permanently removes every record
    /// backed by the target user across all squads while leaving another user's records intact; the
    /// removed rows are gone even when the soft-delete query filter is bypassed, proving a genuine
    /// hard-delete.
    /// </summary>
    [Fact]
    public async Task RemoveForUser_HardDeletesOnlyThatUsersRecordsAcrossSquads()
    {
        await WithMigratedDatabaseAsync(async connectionString =>
        {
            Guid squadOne = await SeedSquadAsync(connectionString, "Squad One");
            Guid squadTwo = await SeedSquadAsync(connectionString, "Squad Two");

            // Alex is backed by one user with a membership in each squad.
            Guid alexUserId = await SeedUserAsync(connectionString, "Alex", "alex@example.com");
            Guid alexInSquadOne = await SeedMembershipForUserAsync(connectionString, squadOne, alexUserId, "Alex");
            Guid alexInSquadTwo = await SeedMembershipForUserAsync(connectionString, squadTwo, alexUserId, "Alex");
            (Guid _, Guid blairInSquadOne) =
                await SeedRegisteredMemberAsync(connectionString, squadOne, "Blair", "blair@example.com");

            var instant = FakeTimeProvider.DefaultNow;
            Guid alexOne = await AddNotificationAsync(connectionString, instant, squadOne, alexInSquadOne, NotificationType.MemberJoined);
            Guid alexTwo = await AddNotificationAsync(connectionString, instant, squadTwo, alexInSquadTwo, NotificationType.MemberJoined);
            Guid blairOne = await AddNotificationAsync(connectionString, instant, squadOne, blairInSquadOne, NotificationType.MemberJoined);

            await using (var act = CreateContext(connectionString))
            {
                await new EfNotificationRepository(act).RemoveForUserAsync(alexUserId, CancellationToken.None);
                await new UnitOfWork(act).SaveChangesAsync(CancellationToken.None);
            }

            await using var verify = CreateContext(connectionString);

            // Alex's records are hard-deleted in both squads — absent even with the query filter off.
            Assert.False(await ExistsIgnoringFiltersAsync(verify, alexOne));
            Assert.False(await ExistsIgnoringFiltersAsync(verify, alexTwo));

            // Blair's record is untouched.
            Assert.True(await ExistsIgnoringFiltersAsync(verify, blairOne));

            // No stray rows: exactly the one surviving row remains in the table.
            Assert.Equal(1, await verify.Set<InAppNotification>().IgnoreQueryFilters().CountAsync());
        });
    }

    // Requirement 11.2 — RemoveForMembershipAsync hard-deletes exactly the records addressed to the
    // anonymised membership and leaves other memberships' records intact.
    /// <summary>
    /// <see cref="EfNotificationRepository.RemoveForMembershipAsync"/> permanently removes exactly the
    /// records addressed to the target membership, leaving another membership's records intact; the
    /// removed rows are gone even with the soft-delete filter bypassed.
    /// </summary>
    [Fact]
    public async Task RemoveForMembership_HardDeletesOnlyThatMembershipsRecords()
    {
        await WithMigratedDatabaseAsync(async connectionString =>
        {
            Guid squadId = await SeedSquadAsync(connectionString, "Membership FC");
            (Guid _, Guid alexMembership) =
                await SeedRegisteredMemberAsync(connectionString, squadId, "Alex", "alex@example.com");
            (Guid _, Guid blairMembership) =
                await SeedRegisteredMemberAsync(connectionString, squadId, "Blair", "blair@example.com");

            var instant = FakeTimeProvider.DefaultNow;
            Guid alexOne = await AddNotificationAsync(connectionString, instant, squadId, alexMembership, NotificationType.MemberJoined);
            Guid alexTwo = await AddNotificationAsync(connectionString, instant.AddMinutes(1), squadId, alexMembership, NotificationType.PromotedToAdmin);
            Guid blairOne = await AddNotificationAsync(connectionString, instant, squadId, blairMembership, NotificationType.MemberJoined);

            await using (var act = CreateContext(connectionString))
            {
                await new EfNotificationRepository(act).RemoveForMembershipAsync(alexMembership, CancellationToken.None);
                await new UnitOfWork(act).SaveChangesAsync(CancellationToken.None);
            }

            await using var verify = CreateContext(connectionString);

            Assert.False(await ExistsIgnoringFiltersAsync(verify, alexOne));
            Assert.False(await ExistsIgnoringFiltersAsync(verify, alexTwo));
            Assert.True(await ExistsIgnoringFiltersAsync(verify, blairOne));
            Assert.Equal(1, await verify.Set<InAppNotification>().IgnoreQueryFilters().CountAsync());
        });
    }

    // Requirement 11.3 — RemoveForSquadAsync hard-deletes exactly the records owned by the purged
    // squad and leaves another squad's records intact.
    /// <summary>
    /// <see cref="EfNotificationRepository.RemoveForSquadAsync"/> permanently removes exactly the
    /// records owned by the target squad, leaving another squad's records intact; the removed rows are
    /// gone even with the soft-delete filter bypassed.
    /// </summary>
    [Fact]
    public async Task RemoveForSquad_HardDeletesOnlyThatSquadsRecords()
    {
        await WithMigratedDatabaseAsync(async connectionString =>
        {
            Guid squadOne = await SeedSquadAsync(connectionString, "Squad One");
            Guid squadTwo = await SeedSquadAsync(connectionString, "Squad Two");

            (Guid _, Guid alexInSquadOne) =
                await SeedRegisteredMemberAsync(connectionString, squadOne, "Alex", "alex@example.com");
            (Guid _, Guid alexInSquadTwo) =
                await SeedRegisteredMemberAsync(connectionString, squadTwo, "Alex", "alex2@example.com");

            var instant = FakeTimeProvider.DefaultNow;
            Guid squadOneOne = await AddNotificationAsync(connectionString, instant, squadOne, alexInSquadOne, NotificationType.MemberJoined);
            Guid squadOneTwo = await AddNotificationAsync(connectionString, instant.AddMinutes(1), squadOne, alexInSquadOne, NotificationType.PromotedToAdmin);
            Guid squadTwoOne = await AddNotificationAsync(connectionString, instant, squadTwo, alexInSquadTwo, NotificationType.MemberJoined);

            await using (var act = CreateContext(connectionString))
            {
                await new EfNotificationRepository(act).RemoveForSquadAsync(squadOne, CancellationToken.None);
                await new UnitOfWork(act).SaveChangesAsync(CancellationToken.None);
            }

            await using var verify = CreateContext(connectionString);

            Assert.False(await ExistsIgnoringFiltersAsync(verify, squadOneOne));
            Assert.False(await ExistsIgnoringFiltersAsync(verify, squadOneTwo));
            Assert.True(await ExistsIgnoringFiltersAsync(verify, squadTwoOne));
            Assert.Equal(1, await verify.Set<InAppNotification>().IgnoreQueryFilters().CountAsync());
        });
    }

    /// <summary>A recorded notification identity and the creation instant it was stamped with.</summary>
    private readonly record struct Recorded(Guid Id, DateTimeOffset CreatedAt);

    /// <summary>Reports whether a notification row exists with the global soft-delete filter bypassed.</summary>
    private static Task<bool> ExistsIgnoringFiltersAsync(PitchMateDbContext context, Guid notificationId) =>
        context.Set<InAppNotification>()
            .IgnoreQueryFilters()
            .AnyAsync(n => n.Id == notificationId);

    /// <summary>Seeds an empty squad and returns its identity.</summary>
    private static async Task<Guid> SeedSquadAsync(string connectionString, string name)
    {
        await using var context = CreateContext(connectionString);
        Squad squad = Squad.Create(name).Value!;
        await new EfSquadRepository(context).AddAsync(squad, CancellationToken.None);
        await new UnitOfWork(context).SaveChangesAsync(CancellationToken.None);
        return squad.Id;
    }

    /// <summary>
    /// Seeds a registered (user-backed) active membership in the squad, returning both the backing
    /// user's identity and the membership identity so tests can address the caller and the recipient.
    /// </summary>
    private static async Task<(Guid UserId, Guid MembershipId)> SeedRegisteredMemberAsync(
        string connectionString, Guid squadId, string displayName, string email)
    {
        await using var context = CreateContext(connectionString);
        User user = User.Create(displayName, email);
        SquadMembership membership = SquadMembership.CreateRegistered(squadId, user.Id, displayName).Value!;

        await new EfUserRepository(context).AddAsync(user, CancellationToken.None);
        await new EfSquadMembershipRepository(context).AddAsync(membership, CancellationToken.None);
        await new UnitOfWork(context).SaveChangesAsync(CancellationToken.None);

        return (user.Id, membership.Id);
    }

    /// <summary>Seeds a user and returns its identity, so several memberships can be bound to it.</summary>
    private static async Task<Guid> SeedUserAsync(string connectionString, string displayName, string email)
    {
        await using var context = CreateContext(connectionString);
        User user = User.Create(displayName, email);
        await new EfUserRepository(context).AddAsync(user, CancellationToken.None);
        await new UnitOfWork(context).SaveChangesAsync(CancellationToken.None);
        return user.Id;
    }

    /// <summary>
    /// Seeds a registered active membership in the squad backed by the <em>existing</em>
    /// <paramref name="userId"/>, returning the membership identity. Used to give one user a
    /// membership in more than one squad.
    /// </summary>
    private static async Task<Guid> SeedMembershipForUserAsync(
        string connectionString, Guid squadId, Guid userId, string displayName)
    {
        await using var context = CreateContext(connectionString);
        SquadMembership membership = SquadMembership.CreateRegistered(squadId, userId, displayName).Value!;
        await new EfSquadMembershipRepository(context).AddAsync(membership, CancellationToken.None);
        await new UnitOfWork(context).SaveChangesAsync(CancellationToken.None);
        return membership.Id;
    }

    /// <summary>
    /// Seeds a guest (no backing user) active membership in the squad. A guest is never a recipient;
    /// it proves the registered-only filtering has real non-registered rows to reject.
    /// </summary>
    private static async Task<Guid> SeedGuestAsync(string connectionString, Guid squadId, string displayName)
    {
        await using var context = CreateContext(connectionString);
        SquadMembership guest =
            SquadMembership.CreateGuest(squadId, displayName, skillTier: null, FakeTimeProvider.DefaultNow).Value!;
        await new EfSquadMembershipRepository(context).AddAsync(guest, CancellationToken.None);
        await new UnitOfWork(context).SaveChangesAsync(CancellationToken.None);
        return guest.Id;
    }

    /// <summary>
    /// Adds a single notification stamped at <paramref name="createdAt"/> (a controllable clock drives
    /// the audit pipeline) and commits it, returning its identity.
    /// </summary>
    private static async Task<Guid> AddNotificationAsync(
        string connectionString, DateTimeOffset createdAt, Guid squadId, Guid membershipId, NotificationType type)
    {
        var clock = new FakeTimeProvider(createdAt);
        await using var context = CreateContext(connectionString, clock);

        InAppNotification notification =
            InAppNotification.Create(squadId, membershipId, type, $"{type} title", $"{type} body").Value!;
        await new EfNotificationRepository(context).AddAsync(notification, CancellationToken.None);
        await new UnitOfWork(context).SaveChangesAsync(CancellationToken.None);
        return notification.Id;
    }

    /// <summary>
    /// Adds two notifications for the same recipient in one save under one clock instant, so both are
    /// stamped with an identical <c>CreatedAt</c> and only the GUID v7 identity tie-break can order
    /// them. Returns the two identities in construction order.
    /// </summary>
    private static async Task<(Guid First, Guid Second)> AddTwoNotificationsAsync(
        string connectionString, DateTimeOffset createdAt, Guid squadId, Guid membershipId)
    {
        var clock = new FakeTimeProvider(createdAt);
        await using var context = CreateContext(connectionString, clock);

        InAppNotification first =
            InAppNotification.Create(squadId, membershipId, NotificationType.TeamsRolled, "first title", "first body").Value!;
        InAppNotification second =
            InAppNotification.Create(squadId, membershipId, NotificationType.ResultPosted, "second title", "second body").Value!;

        var repository = new EfNotificationRepository(context);
        await repository.AddAsync(first, CancellationToken.None);
        await repository.AddAsync(second, CancellationToken.None);
        await new UnitOfWork(context).SaveChangesAsync(CancellationToken.None);

        return (first.Id, second.Id);
    }

    /// <summary>Loads a notification and marks it read, committing the change.</summary>
    private static async Task MarkReadAsync(string connectionString, Guid notificationId)
    {
        await using var context = CreateContext(connectionString);
        InAppNotification notification =
            await context.Set<InAppNotification>().FirstAsync(n => n.Id == notificationId);
        notification.MarkRead();
        await new UnitOfWork(context).SaveChangesAsync(CancellationToken.None);
    }

    /// <summary>Reads the raw integer <c>type</c> and <c>read_state</c> columns for one notification row.</summary>
    private static async Task<(int Type, int ReadState)> ReadEnumColumnsAsync(
        string connectionString, Guid notificationId)
    {
        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync();

        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT type, read_state FROM in_app_notification WHERE id = @id;";
        command.Parameters.AddWithValue("id", notificationId);

        await using var reader = await command.ExecuteReaderAsync();
        Assert.True(await reader.ReadAsync(), "Expected the notification row to exist.");
        return (reader.GetInt32(0), reader.GetInt32(1));
    }

    /// <summary>
    /// Creates a production <see cref="PitchMateDbContext"/> bound to the throwaway database with a
    /// default fixed clock and no acting user.
    /// </summary>
    private static PitchMateDbContext CreateContext(string connectionString) =>
        CreateContext(connectionString, new FakeTimeProvider());

    /// <summary>
    /// Creates a production <see cref="PitchMateDbContext"/> bound to the throwaway database using the
    /// supplied clock so audit stamping observes a controllable instant.
    /// </summary>
    private static PitchMateDbContext CreateContext(string connectionString, TimeProvider clock) =>
        new(
            MigrationTestSupport.BuildContextOptions(connectionString),
            clock,
            new FakeCurrentUserAccessor());

    /// <summary>
    /// Creates a uniquely-named empty database on the shared server, applies the production EF Core
    /// migrations to it (validating the notification migration too), runs the test body against a
    /// connection string targeting it, and drops it afterwards regardless of outcome.
    /// </summary>
    private async Task WithMigratedDatabaseAsync(Func<string, Task> body)
    {
        var databaseName = "notif_" + Guid.NewGuid().ToString("N");
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
}
