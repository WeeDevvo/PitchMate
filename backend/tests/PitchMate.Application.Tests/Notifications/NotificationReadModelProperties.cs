using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Application.Notifications;
using PitchMate.Domain.Common;
using PitchMate.Domain.Notifications;
using PitchMate.Domain.Squads;
using DomainErrorCode = PitchMate.Domain.Notifications.NotificationErrorCode;
using DomainResult = PitchMate.Domain.Notifications.Result<System.Collections.Generic.IReadOnlyList<PitchMate.Application.Notifications.NotificationSummary>>;
using CountResult = PitchMate.Domain.Notifications.Result<int>;

namespace PitchMate.Application.Tests.Notifications;

/// <summary>
/// Property-based tests for the notification read model — <see cref="ListNotificationsHandler"/> and
/// <see cref="GetUnreadCountHandler"/> — covering notifications design Properties 16, 17, and 18. They
/// drive the real handlers against the in-memory <see cref="ReadModelNotificationRepository"/> over a
/// <see cref="NotificationReadModelStore"/> (no database), per the Application-layer testing strategy.
/// Each property runs at least 100 generated cases.
/// <para>
/// The population each scenario builds mixes registered/guest and active/inactive memberships across
/// several squads and several backing users, seeds the caller's own notifications (with deliberately
/// tied creation instants and mixed read states) alongside foreign notifications — including
/// foreign records in the very squads the caller belongs to (same squad, different user) — so the
/// own-records-only, scoping, ordering, cap, and non-disclosure guarantees are all genuinely exercised.
/// </para>
/// </summary>
[Trait("Feature", "notifications")]
public class NotificationReadModelProperties
{
    private static readonly DateTimeOffset BaseInstant = DateTimeOffset.Parse("2025-01-01T00:00:00Z");
    private static readonly NotificationType[] AllTypes = Enum.GetValues<NotificationType>();

    // Feature: notifications, Property 16: Listing returns the caller's own records in a stable, capped,
    // scoped, deterministic order - for any stored records and any caller, the list returns only records
    // whose recipient membership is backed by that caller (optionally restricted to a specified squad),
    // ordered by creation instant descending with ties broken by GUID v7 identity descending (a stable
    // total order), capped at the 200 most recent by that order, with each row projecting its type,
    // owning squad, title, body, creation instant, and read state; repeating the identical request over
    // unchanged data returns the identical result.
    // Validates: Requirements 9.1, 9.2, 9.4, 9.8, 9.9, 9.10
    [Property(MaxTest = 100)]
    [Trait("Property", "16")]
    public Property Property16_ListingIsOwnScopedStableCappedDeterministic() =>
        Prop.ForAll(Arb.From(ReadScenarioGen(maxNotifications: 240)), scenario =>
        {
            Population pop = BuildPopulation(scenario);
            Guid? scope = PickScope(pop, scenario.ScopeMode, scenario.SquadPick);
            var handler = new ListNotificationsHandler(new ReadModelNotificationRepository(pop.Store));

            var command = new ListNotificationsCommand(pop.CallerId, scope);
            DomainResult result =
                handler.HandleAsync(command, CancellationToken.None).GetAwaiter().GetResult();

            if (!result.IsSuccess)
            {
                return false.ToProperty();
            }

            IReadOnlyList<NotificationSummary> returned = result.Value!;

            // Expected: the caller's own records in scope, ordered CreatedAt desc then Id desc, capped 200.
            List<InAppNotification> expected = pop.CallerNotifications
                .Where(n => scope is null || n.SquadId == scope.Value)
                .OrderByDescending(n => n.CreatedAt)
                .ThenByDescending(n => n.Id, UuidV7Comparer.Instance)
                .Take(ListNotificationsHandler.MaxListSize)
                .ToList();

            // Order-sensitive identity match (stable, capped, scoped, own-records-only).
            bool sameOrderAndSet = returned.Select(s => s.NotificationId)
                .SequenceEqual(expected.Select(n => n.Id));

            bool cappedAt200 = returned.Count <= ListNotificationsHandler.MaxListSize;

            // Every returned row is one of the caller's own in-scope records (no foreign leakage).
            HashSet<Guid> ownInScope = expected.Select(n => n.Id).ToHashSet();
            bool onlyOwnInScope = returned.All(s => ownInScope.Contains(s.NotificationId));

            // Each row projects exactly its source record's fields (Requirement 9.2).
            Dictionary<Guid, InAppNotification> byId = pop.CallerNotifications.ToDictionary(n => n.Id);
            bool projectionFaithful = returned.All(s =>
                byId.TryGetValue(s.NotificationId, out InAppNotification? rec)
                && s.Type == rec.Type
                && s.SquadId == rec.SquadId
                && s.Title == rec.Title
                && s.Body == rec.Body
                && s.CreatedAt == rec.CreatedAt
                && s.ReadState == rec.ReadState);

            // Determinism: an identical request over unchanged data returns the identical ordering.
            DomainResult again =
                handler.HandleAsync(command, CancellationToken.None).GetAwaiter().GetResult();
            bool deterministic = again.IsSuccess
                && again.Value!.Select(s => s.NotificationId)
                    .SequenceEqual(returned.Select(s => s.NotificationId));

            return (sameOrderAndSet && cappedAt200 && onlyOwnInScope && projectionFaithful && deterministic)
                .ToProperty();
        });

    // Feature: notifications, Property 17: The unread count equals the caller's own unread records in
    // scope - for any stored records and any caller, the unread count equals the exact number of the
    // caller's own Unread records (optionally restricted to a specified squad), is a non-negative whole
    // number, returns 0 when there are none, and returns the identical value for repeated identical
    // requests.
    // Validates: Requirements 9.3, 9.4, 9.8
    [Property(MaxTest = 200)]
    [Trait("Property", "17")]
    public Property Property17_UnreadCountEqualsOwnUnreadInScope() =>
        Prop.ForAll(Arb.From(ReadScenarioGen(maxNotifications: 60)), scenario =>
        {
            Population pop = BuildPopulation(scenario);
            Guid? scope = PickScope(pop, scenario.ScopeMode, scenario.SquadPick);
            var handler = new GetUnreadCountHandler(new ReadModelNotificationRepository(pop.Store));

            var command = new GetUnreadCountCommand(pop.CallerId, scope);
            CountResult result = handler.HandleAsync(command, CancellationToken.None).GetAwaiter().GetResult();

            if (!result.IsSuccess)
            {
                return false.ToProperty();
            }

            int expected = pop.CallerNotifications
                .Count(n => n.ReadState == ReadState.Unread && (scope is null || n.SquadId == scope.Value));

            bool exact = result.Value == expected;
            bool nonNegative = result.Value >= 0;
            bool zeroWhenNone = expected != 0 || result.Value == 0;

            // Repeated identical request yields the identical value.
            CountResult again = handler.HandleAsync(command, CancellationToken.None).GetAwaiter().GetResult();
            bool deterministic = again.IsSuccess && again.Value == result.Value;

            return (exact && nonNegative && zeroWhenNone && deterministic).ToProperty();
        });

    // Feature: notifications, Property 18: The read model discloses nothing beyond the caller's own
    // accessible records - for any list/count scoped to a squad in which the caller holds no membership
    // of any state, the response is a uniform not-found that neither confirms nor denies existence; an
    // unauthenticated request is rejected without disclosure; and every record ever returned to a caller
    // is backed by that caller and owned by a squad the caller belongs to - including a squad the caller
    // was removed from (their membership state is Inactive).
    // Validates: Requirements 10.1, 10.3, 10.4, 10.5, 10.6
    [Property(MaxTest = 200)]
    [Trait("Property", "18")]
    public Property Property18_ReadModelDisclosesNothingBeyondOwnAccessibleRecords() =>
        Prop.ForAll(Arb.From(ReadScenarioGen(maxNotifications: 60)), scenario =>
        {
            Population pop = BuildPopulation(scenario);
            var list = new ListNotificationsHandler(new ReadModelNotificationRepository(pop.Store));
            var count = new GetUnreadCountHandler(new ReadModelNotificationRepository(pop.Store));

            // 1. Unauthenticated requests are rejected with Unauthenticated, disclosing nothing (10.2).
            DomainResult anonList =
                list.HandleAsync(new ListNotificationsCommand(null, null), CancellationToken.None)
                    .GetAwaiter().GetResult();
            CountResult anonCount =
                count.HandleAsync(new GetUnreadCountCommand(null, null), CancellationToken.None)
                    .GetAwaiter().GetResult();
            bool unauthenticatedRejected =
                !anonList.IsSuccess && anonList.Error?.Code == DomainErrorCode.Unauthenticated
                && !anonCount.IsSuccess && anonCount.Error?.Code == DomainErrorCode.Unauthenticated;

            // 2. A list/count scoped to a squad the caller holds no membership in returns the uniform,
            //    non-disclosing NotFound - even though that squad genuinely holds records (10.3, 10.4, 10.5).
            DomainResult foreignList =
                list.HandleAsync(new ListNotificationsCommand(pop.CallerId, pop.ForeignSquadId), CancellationToken.None)
                    .GetAwaiter().GetResult();
            CountResult foreignCount =
                count.HandleAsync(new GetUnreadCountCommand(pop.CallerId, pop.ForeignSquadId), CancellationToken.None)
                    .GetAwaiter().GetResult();
            bool foreignScopeNonDisclosing =
                !foreignList.IsSuccess && foreignList.Error?.Code == DomainErrorCode.NotFound
                && !foreignCount.IsSuccess && foreignCount.Error?.Code == DomainErrorCode.NotFound;

            // 3. Every record returned to the caller is backed by the caller and owned by a squad the
            //    caller belongs to (active or inactive-by-removal) - never a foreign record (10.1, 10.6).
            DomainResult ownList =
                list.HandleAsync(new ListNotificationsCommand(pop.CallerId, null), CancellationToken.None)
                    .GetAwaiter().GetResult();
            HashSet<Guid> callerSquadIds = pop.ActiveSquadIds.Concat(pop.InactiveSquadIds).ToHashSet();
            HashSet<Guid> ownRecordIds = pop.CallerNotifications.Select(n => n.Id).ToHashSet();
            bool onlyOwnAccessible = ownList.IsSuccess
                && ownList.Value!.All(s => ownRecordIds.Contains(s.NotificationId) && callerSquadIds.Contains(s.SquadId));

            // 4. A scope onto a squad the caller was removed from (Inactive) still succeeds and returns
            //    that squad's own records (10.6).
            bool removedSquadStillReadable = true;
            if (pop.InactiveSquadIds.Count > 0)
            {
                Guid removedSquad = pop.InactiveSquadIds[0];
                DomainResult removedList =
                    list.HandleAsync(new ListNotificationsCommand(pop.CallerId, removedSquad), CancellationToken.None)
                        .GetAwaiter().GetResult();
                List<Guid> expectedInRemoved = pop.CallerNotifications
                    .Where(n => n.SquadId == removedSquad)
                    .Select(n => n.Id)
                    .ToList();
                removedSquadStillReadable = removedList.IsSuccess
                    && removedList.Value!.Select(s => s.NotificationId).ToHashSet()
                        .SetEquals(expectedInRemoved);
            }

            return (unauthenticatedRejected
                && foreignScopeNonDisclosing
                && onlyOwnAccessible
                && removedSquadStillReadable).ToProperty();
        });

    // --- Generators -------------------------------------------------------------------------------

    private static Gen<ReadScenario> ReadScenarioGen(int maxNotifications) =>
        from seed in Gen.Choose(1, 1_000_000)
        from activeSquads in Gen.Choose(1, 4)
        from inactiveSquads in Gen.Choose(0, 2)
        from notifCount in Gen.Choose(0, maxNotifications)
        from foreignCount in Gen.Choose(0, 15)
        from scopeMode in Gen.Choose(0, 2)
        from squadPick in Gen.Choose(0, 100)
        select new ReadScenario(seed, activeSquads, inactiveSquads, notifCount, foreignCount, scopeMode, squadPick);

    // --- Population -------------------------------------------------------------------------------

    private static Population BuildPopulation(ReadScenario scenario)
    {
        var rng = new Random(scenario.Seed);
        var store = new NotificationReadModelStore();
        Guid callerId = Guid.CreateVersion7();

        // The caller's memberships: one per squad, some Active, some Inactive-by-removal. "Own" is decided
        // by the backing user, never by state, so an inactive membership's records remain the caller's own.
        var activeSquadIds = new List<Guid>();
        var inactiveSquadIds = new List<Guid>();
        var callerMemberships = new List<SquadMembership>();

        for (int i = 0; i < scenario.ActiveSquads; i++)
        {
            var squadId = Guid.CreateVersion7();
            SquadMembership m = SquadMembership.CreateRegistered(squadId, callerId, $"caller-active-{i}").Value!;
            store.AddMembership(m);
            callerMemberships.Add(m);
            activeSquadIds.Add(squadId);
        }

        for (int i = 0; i < scenario.InactiveSquads; i++)
        {
            var squadId = Guid.CreateVersion7();
            SquadMembership m = SquadMembership.CreateRegistered(squadId, callerId, $"caller-inactive-{i}").Value!;
            m.Deactivate();
            store.AddMembership(m);
            callerMemberships.Add(m);
            inactiveSquadIds.Add(squadId);
        }

        // Foreign memberships in the caller's own squads (same squad, different user) so the own-records
        // filter must key on the backing user, not merely the squad.
        var foreignMemberships = new List<SquadMembership>();
        List<Guid> callerSquadIds = activeSquadIds.Concat(inactiveSquadIds).ToList();
        foreach (Guid squadId in callerSquadIds)
        {
            SquadMembership foreign =
                SquadMembership.CreateRegistered(squadId, Guid.CreateVersion7(), "foreign-samesquad").Value!;
            store.AddMembership(foreign);
            foreignMemberships.Add(foreign);
        }

        // A guest membership in a caller squad (never the caller's own, never a recipient of anything).
        if (callerSquadIds.Count > 0)
        {
            SquadMembership guest =
                SquadMembership.CreateGuest(callerSquadIds[0], "guest", skillTier: null, BaseInstant).Value!;
            store.AddMembership(guest);
        }

        // A dedicated foreign squad the caller holds NO membership in, with a foreign member and records.
        var foreignSquadId = Guid.CreateVersion7();
        SquadMembership foreignSquadMember =
            SquadMembership.CreateRegistered(foreignSquadId, Guid.CreateVersion7(), "foreign-squad-member").Value!;
        store.AddMembership(foreignSquadMember);
        foreignMemberships.Add(foreignSquadMember);

        // The caller's own notifications, addressed across the caller's memberships, with tied creation
        // instants (a small instant pool) and mixed read states.
        var callerNotifications = new List<InAppNotification>();
        for (int i = 0; i < scenario.NotifCount; i++)
        {
            SquadMembership target = callerMemberships[rng.Next(callerMemberships.Count)];
            InAppNotification n = MakeNotification(
                target.SquadId,
                target.Id,
                AllTypes[rng.Next(AllTypes.Length)],
                InstantBucket(rng),
                (ReadState)rng.Next(2),
                $"caller-title-{i}",
                $"caller-body-{i}");
            store.AddNotification(n);
            callerNotifications.Add(n);
        }

        // Foreign notifications - never the caller's own. Always seed at least one in the foreign squad so
        // that squad genuinely holds records the caller must never be told about.
        InAppNotification foreignSeed = MakeNotification(
            foreignSquadId, foreignSquadMember.Id, NotificationType.MemberJoined,
            InstantBucket(rng), ReadState.Unread, "foreign-seed-title", "foreign-seed-body");
        store.AddNotification(foreignSeed);

        for (int i = 0; i < scenario.ForeignCount; i++)
        {
            SquadMembership target = foreignMemberships[rng.Next(foreignMemberships.Count)];
            InAppNotification n = MakeNotification(
                target.SquadId,
                target.Id,
                AllTypes[rng.Next(AllTypes.Length)],
                InstantBucket(rng),
                (ReadState)rng.Next(2),
                $"foreign-title-{i}",
                $"foreign-body-{i}");
            store.AddNotification(n);
        }

        return new Population(
            store, callerId, activeSquadIds, inactiveSquadIds, foreignSquadId, callerNotifications);
    }

    // A small pool of creation instants so many records collide on CreatedAt, forcing the id tie-break.
    private static DateTimeOffset InstantBucket(Random rng) => BaseInstant.AddHours(rng.Next(0, 4));

    private static InAppNotification MakeNotification(
        Guid squadId,
        Guid recipientMembershipId,
        NotificationType type,
        DateTimeOffset createdAt,
        ReadState readState,
        string title,
        string body)
    {
        InAppNotification n = InAppNotification.Create(squadId, recipientMembershipId, type, title, body).Value!;
        n.CreatedAt = createdAt;
        n.UpdatedAt = createdAt;
        if (readState == ReadState.Read)
        {
            n.MarkRead();
        }

        return n;
    }

    private static Guid? PickScope(Population pop, int scopeMode, int squadPick) => scopeMode switch
    {
        1 when pop.ActiveSquadIds.Count > 0 => pop.ActiveSquadIds[squadPick % pop.ActiveSquadIds.Count],
        2 when pop.InactiveSquadIds.Count > 0 => pop.InactiveSquadIds[squadPick % pop.InactiveSquadIds.Count],
        _ => null,
    };

    // --- Records ----------------------------------------------------------------------------------

    public sealed record ReadScenario(
        int Seed, int ActiveSquads, int InactiveSquads, int NotifCount, int ForeignCount, int ScopeMode, int SquadPick);

    private sealed record Population(
        NotificationReadModelStore Store,
        Guid CallerId,
        IReadOnlyList<Guid> ActiveSquadIds,
        IReadOnlyList<Guid> InactiveSquadIds,
        Guid ForeignSquadId,
        IReadOnlyList<InAppNotification> CallerNotifications);
}

