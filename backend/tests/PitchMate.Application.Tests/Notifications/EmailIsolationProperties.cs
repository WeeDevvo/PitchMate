using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Application.Auth;
using PitchMate.Application.Auth.Abstractions;
using PitchMate.Application.Notifications;
using PitchMate.Domain.Notifications;
using PitchMate.Domain.Squads;
using Factory = PitchMate.Application.Tests.Notifications.NotificationMembershipFactory;
using DomainResult = PitchMate.Domain.Notifications.Result;
using AuthResult = PitchMate.Application.Auth.Result;

namespace PitchMate.Application.Tests.Notifications;

/// <summary>
/// Property-based tests for the best-effort, isolated email dispatch layered onto
/// <see cref="PublishNotificationHandler"/> after the in-app records commit (notifications design
/// Properties 9–12). They drive the real handler against the in-memory
/// <see cref="FakeNotificationRepository"/> over a <see cref="NotificationStore"/>, committing through the
/// <see cref="NotificationPublishFakeUnitOfWork"/> and dispatching through the configurable
/// <see cref="FakeEmailSender"/> / <see cref="FakeNotificationEmailRenderer"/> (no database, no real
/// transport), per the Application-layer testing strategy. Each property runs at least 100 generated cases.
/// <para>
/// The email channel is best effort: it runs only after the in-app fan-out has committed and must never
/// change the committed records or the publish result, never halt the fan-out, and never log notification
/// content or recipient addresses. These properties exercise every per-recipient email outcome — success,
/// a failure <see cref="AuthResult"/>, a thrown exception, and a timeout — modelled synchronously so the
/// tests stay fast (a timeout is a synchronously thrown <see cref="TaskCanceledException"/>, never a real
/// 30-second wait).
/// </para>
/// </summary>
[Trait("Feature", "notifications")]
public class EmailIsolationProperties
{
    // Broadcast types fan out to the squad's active registered memberships, giving a clean, fully
    // controllable recipient set (every active registered member is a recipient) for the email properties.
    private static readonly NotificationType[] BroadcastTypes =
    [
        NotificationType.MatchDrafted,
        NotificationType.MatchConfirmed,
        NotificationType.TeamsRolled,
        NotificationType.ResultPosted,
    ];

    /// <summary>The per-recipient email outcomes the fan-out must isolate.</summary>
    private enum EmailOutcome
    {
        /// <summary>The transport accepts the message.</summary>
        Success,

        /// <summary>The transport returns a failure <see cref="AuthResult"/> (for example a rejected address).</summary>
        FailResult,

        /// <summary>The send throws an exception.</summary>
        Throw,

        /// <summary>The send exceeds its budget, modelled as a synchronously thrown <see cref="TaskCanceledException"/>.</summary>
        Timeout,
    }

    // Feature: notifications, Property 9: In-app records are committed before any email, and email outcome
    // never affects them - every in-app record is persisted before any email is attempted, and for any
    // combination of per-recipient email outcomes (success, failure Result, thrown exception, timeout) the
    // set of persisted in-app records and their read states are identical to the email-free run.
    // Validates: Requirements 5.2, 5.3, 6.1, 6.5
    [Property(MaxTest = 200)]
    [Trait("Property", "9")]
    public Property Property9_InAppCommittedBeforeEmailAndUnaffectedByOutcome() =>
        Prop.ForAll(Arb.From(OutcomeScenarioGen()), scenario =>
        {
            var squadId = Guid.CreateVersion7();
            NotificationType type = BroadcastTypes[scenario.TypeIndex % BroadcastTypes.Length];

            // One membership population shared by both runs, so the two committed sets are directly
            // comparable by recipient id.
            List<SquadMembership> recipients = ActiveRegistered(squadId, scenario.Outcomes.Count);

            // Email-free baseline: no addresses recorded, so the dispatch resolves an empty map and no send
            // is attempted. This is the reference committed set.
            NotificationStore baselineStore = SeedStore(recipients, withEmails: false);
            PublishNotificationHandler baselineHandler = NewHandler(baselineStore, new FakeEmailSender());
            DomainResult baselineResult = Publish(baselineHandler, type, squadId);
            HashSet<Guid> baselineIds = baselineStore.Added.Select(n => n.RecipientMembershipId).ToHashSet();

            // Mixed-outcome run: every recipient has a deliverable address and a generated outcome. Capture
            // how many in-app records were already committed at the moment of the first send attempt.
            NotificationStore mixedStore = SeedStore(recipients, withEmails: true);
            var sender = new FakeEmailSender();
            int committedAtFirstSend = -1;
            Dictionary<string, EmailOutcome> outcomeByEmail = OutcomeByEmail(recipients, scenario.Outcomes);
            sender.Behaviour = (message, _) =>
            {
                if (committedAtFirstSend < 0)
                {
                    committedAtFirstSend = mixedStore.Added.Count;
                }

                return Outcome(outcomeByEmail[message.Recipient]);
            };
            PublishNotificationHandler mixedHandler = NewHandler(mixedStore, sender);
            DomainResult mixedResult = Publish(mixedHandler, type, squadId);

            IReadOnlyList<InAppNotification> mixedAdded = mixedStore.Added;
            HashSet<Guid> mixedIds = mixedAdded.Select(n => n.RecipientMembershipId).ToHashSet();
            var expectedIds = recipients.Select(m => m.Id).ToHashSet();

            // At the first send, every in-app record was already committed (records precede any email).
            bool committedBeforeEmail = committedAtFirstSend == recipients.Count;

            // The committed set is identical to the email-free run: same recipients, same count, all Unread,
            // all carrying the type and squad — regardless of the email outcomes.
            bool identicalToEmailFreeRun =
                baselineResult.IsSuccess
                && mixedResult.IsSuccess
                && mixedIds.SetEquals(baselineIds)
                && mixedIds.SetEquals(expectedIds)
                && mixedAdded.Count == recipients.Count
                && mixedAdded.All(n => n.ReadState == ReadState.Unread)
                && mixedAdded.All(n => n.Type == type)
                && mixedAdded.All(n => n.SquadId == squadId);

            return (committedBeforeEmail && identicalToEmailFreeRun).ToProperty();
        });

    // Feature: notifications, Property 10: Email failure is isolated and never halts the fan-out - for any
    // subset of recipients whose email fails/throws/times out, the publish still reports success (Ok),
    // every recipient's in-app record remains present and unchanged, and email is still attempted for every
    // remaining recipient.
    // Validates: Requirements 6.2, 6.3, 6.7
    [Property(MaxTest = 200)]
    [Trait("Property", "10")]
    public Property Property10_EmailFailureIsIsolatedAndNeverHaltsFanOut() =>
        Prop.ForAll(Arb.From(OutcomeScenarioGen()), scenario =>
        {
            var squadId = Guid.CreateVersion7();
            NotificationType type = BroadcastTypes[scenario.TypeIndex % BroadcastTypes.Length];

            List<SquadMembership> recipients = ActiveRegistered(squadId, scenario.Outcomes.Count);
            NotificationStore store = SeedStore(recipients, withEmails: true);

            var sender = new FakeEmailSender();
            Dictionary<string, EmailOutcome> outcomeByEmail = OutcomeByEmail(recipients, scenario.Outcomes);
            sender.Behaviour = (message, _) => Outcome(outcomeByEmail[message.Recipient]);

            PublishNotificationHandler handler = NewHandler(store, sender);
            DomainResult result = Publish(handler, type, squadId);

            // Publish reports success even though a subset of emails failed/threw/timed out.
            bool reportsSuccess = result.IsSuccess;

            // Every recipient's in-app record is present and unchanged (one Unread record per recipient).
            var expectedIds = recipients.Select(m => m.Id).ToHashSet();
            IReadOnlyList<InAppNotification> added = store.Added;
            bool everyRecordPresentAndUnchanged =
                added.Count == recipients.Count
                && added.Select(n => n.RecipientMembershipId).ToHashSet().SetEquals(expectedIds)
                && added.All(n => n.ReadState == ReadState.Unread)
                && added.All(n => n.Type == type && n.SquadId == squadId);

            // Email was attempted for every recipient with a deliverable address (here, all of them),
            // regardless of how earlier recipients' sends fared — the fan-out never halted.
            var attemptedRecipients = sender.Sent.Select(m => m.Recipient).ToHashSet();
            var expectedEmails = recipients.Select(m => EmailFor(m.Id)).ToHashSet();
            bool attemptedEveryRecipient =
                sender.Sent.Count == recipients.Count && attemptedRecipients.SetEquals(expectedEmails);

            return (reportsSuccess && everyRecordPresentAndUnchanged && attemptedEveryRecipient).ToProperty();
        });

    // Feature: notifications, Property 11: Email failure logs carry identifiers but never notification
    // content or addresses - for a recipient whose email fails, the failure log entry contains the
    // NotificationType, owning squad id, and recipient membership id and a reason, and contains NONE of the
    // rendered subject, rendered body, or recipient's email address.
    // Validates: Requirements 6.4
    [Property(MaxTest = 200)]
    [Trait("Property", "11")]
    public Property Property11_FailureLogCarriesIdentifiersNeverContentOrAddress() =>
        Prop.ForAll(Arb.From(FailingSingleRecipientGen()), scenario =>
        {
            var squadId = Guid.CreateVersion7();
            NotificationType type = BroadcastTypes[scenario.TypeIndex % BroadcastTypes.Length];

            // A single recipient with a KNOWN distinctive email address, and a KNOWN distinctive squad name
            // that the renderer embeds into the subject and body — so we can search the logs for those exact
            // strings.
            SquadMembership recipient = Factory.RegisteredActive(squadId, "recipient");
            string distinctiveEmail = scenario.DistinctiveEmail;

            var store = new NotificationStore();
            store.AddMembership(recipient);
            store.SetEmail(recipient.Id, distinctiveEmail);

            var context = new NotificationContext { SquadName = scenario.DistinctiveSquadName };
            var renderer = new FakeNotificationEmailRenderer();
            var sender = new FakeEmailSender { Behaviour = (_, _) => Outcome(scenario.Outcome) };
            var logger = new CapturingLogger<PublishNotificationHandler>();
            var handler = new PublishNotificationHandler(
                new FakeNotificationRepository(store),
                new NotificationPublishFakeUnitOfWork(store),
                renderer,
                sender,
                logger);

            DomainResult result = handler
                .PublishAsync(type, squadId, [], context, CancellationToken.None)
                .GetAwaiter()
                .GetResult();

            // The renderer produced exactly one message; capture its exact subject and body.
            EmailMessage rendered = renderer.Messages.Single();

            // Exactly one failure log entry was emitted for the failing send.
            IReadOnlyList<CapturedLogEntry> failureEntries = logger.Entries;

            bool identifiersPresent = failureEntries.Any(entry =>
                EntryContains(entry, type.ToString())
                && EntryContains(entry, squadId.ToString())
                && EntryContains(entry, recipient.Id.ToString())
                && EntryHasValue(entry, "Reason"));

            // The rendered subject, rendered body, and recipient address never appear anywhere in any log
            // entry (formatted message or structured state values).
            bool noContentOrAddressLeaked = failureEntries.All(entry =>
                !EntryContains(entry, rendered.Subject)
                && !EntryContains(entry, rendered.Body)
                && !EntryContains(entry, distinctiveEmail));

            return (result.IsSuccess && identifiersPresent && noContentOrAddressLeaked).ToProperty();
        });

    // Feature: notifications, Property 12: A recipient with no deliverable email is skipped, not failed -
    // for any recipient whose user has no deliverable email (absent/empty), publish skips email for that
    // recipient, still persists the in-app record, and treats the skip as a non-error (Ok, no send
    // attempted for that recipient).
    // Validates: Requirements 6.6
    [Property(MaxTest = 200)]
    [Trait("Property", "12")]
    public Property Property12_RecipientWithNoEmailIsSkippedNotFailed() =>
        Prop.ForAll(Arb.From(DeliverabilityScenarioGen()), scenario =>
        {
            var squadId = Guid.CreateVersion7();
            NotificationType type = BroadcastTypes[scenario.TypeIndex % BroadcastTypes.Length];

            List<SquadMembership> recipients = ActiveRegistered(squadId, scenario.Deliverable.Count);

            // Each recipient either has a deliverable address or none (absent/empty), per the scenario.
            var store = new NotificationStore();
            var withEmail = new HashSet<Guid>();
            for (int i = 0; i < recipients.Count; i++)
            {
                SquadMembership recipient = recipients[i];
                store.AddMembership(recipient);
                if (scenario.Deliverable[i])
                {
                    store.SetEmail(recipient.Id, EmailFor(recipient.Id));
                    withEmail.Add(recipient.Id);
                }
                else if (scenario.UseEmptyRatherThanAbsent)
                {
                    // An empty address is treated exactly like an absent one (skip, non-error).
                    store.SetEmail(recipient.Id, string.Empty);
                }
            }

            var sender = new FakeEmailSender();
            PublishNotificationHandler handler = NewHandler(store, sender);
            DomainResult result = Publish(handler, type, squadId);

            // The in-app record is persisted for every recipient regardless of email deliverability.
            var expectedIds = recipients.Select(m => m.Id).ToHashSet();
            IReadOnlyList<InAppNotification> added = store.Added;
            bool everyInAppRecordPersisted =
                added.Count == recipients.Count
                && added.Select(n => n.RecipientMembershipId).ToHashSet().SetEquals(expectedIds)
                && added.All(n => n.ReadState == ReadState.Unread);

            // No send was attempted for a recipient with no deliverable email; sends happened only for the
            // deliverable ones. Skipping is a non-error, so the publish still succeeds.
            var attempted = sender.Sent.Select(m => m.Recipient).ToHashSet();
            var expectedAttempts = withEmail.Select(EmailFor).ToHashSet();
            bool onlyDeliverableAttempted =
                sender.Sent.Count == withEmail.Count && attempted.SetEquals(expectedAttempts);

            return (result.IsSuccess && everyInAppRecordPersisted && onlyDeliverableAttempted).ToProperty();
        });

    // --- Generators -------------------------------------------------------------------------------

    private static Gen<EmailOutcome> EmailOutcomeGen() =>
        Gen.Elements(EmailOutcome.Success, EmailOutcome.FailResult, EmailOutcome.Throw, EmailOutcome.Timeout);

    private static Gen<OutcomeScenario> OutcomeScenarioGen() =>
        from typeIndex in Gen.Choose(0, BroadcastTypes.Length - 1)
        from count in Gen.Choose(1, 6)
        from outcomes in Gen.ListOf(EmailOutcomeGen(), count)
        select new OutcomeScenario(typeIndex, outcomes.ToList());

    private static Gen<FailingSingleRecipient> FailingSingleRecipientGen() =>
        from typeIndex in Gen.Choose(0, BroadcastTypes.Length - 1)
        // A failing send only: FailResult, Throw, or Timeout (never Success), so a failure log is emitted.
        from outcome in Gen.Elements(EmailOutcome.FailResult, EmailOutcome.Throw, EmailOutcome.Timeout)
        from squadToken in DistinctiveTokenGen()
        from emailLocal in DistinctiveTokenGen()
        select new FailingSingleRecipient(
            typeIndex,
            outcome,
            $"Squad-{squadToken}",
            $"{emailLocal}@distinctive.test");

    private static Gen<DeliverabilityScenario> DeliverabilityScenarioGen() =>
        from typeIndex in Gen.Choose(0, BroadcastTypes.Length - 1)
        from useEmpty in Gen.Elements(true, false)
        from count in Gen.Choose(1, 6)
        from deliverable in Gen.ListOf(Gen.Elements(true, false), count)
        select new DeliverabilityScenario(typeIndex, useEmpty, deliverable.ToList());

    // A distinctive alphanumeric token unlikely to collide with any log field name or fixed log text.
    private static Gen<string> DistinctiveTokenGen() =>
        from chars in Gen.ListOf(Gen.Elements("QZXVWK7395".ToCharArray()), 12)
        select "Z9" + new string(chars.ToArray());

    // --- Helpers ----------------------------------------------------------------------------------

    // Maps a per-recipient outcome to the FakeEmailSender's completion. A timeout/throw is modelled by
    // throwing synchronously so no test ever waits for the real 30-second budget.
    private static Task<AuthResult> Outcome(EmailOutcome outcome) => outcome switch
    {
        EmailOutcome.Success => Task.FromResult(AuthResult.Ok()),
        EmailOutcome.FailResult => Task.FromResult(
            AuthResult.Fail(new AuthError(AuthErrorCode.DeliveryFailed, "delivery diagnostic"))),
        EmailOutcome.Throw => throw new InvalidOperationException("simulated transport failure"),
        EmailOutcome.Timeout => throw new TaskCanceledException("simulated send timeout"),
        _ => Task.FromResult(AuthResult.Ok()),
    };

    private static List<SquadMembership> ActiveRegistered(Guid squadId, int count) =>
        Enumerable.Range(0, count)
            .Select(i => Factory.RegisteredActive(squadId, $"recipient-{i}"))
            .ToList();

    // A stable, distinctive deliverable address derived from the membership id.
    private static string EmailFor(Guid membershipId) => $"m-{membershipId:N}@recipients.test";

    private static NotificationStore SeedStore(IEnumerable<SquadMembership> recipients, bool withEmails)
    {
        var store = new NotificationStore();
        foreach (SquadMembership recipient in recipients)
        {
            store.AddMembership(recipient);
            if (withEmails)
            {
                store.SetEmail(recipient.Id, EmailFor(recipient.Id));
            }
        }

        return store;
    }

    private static Dictionary<string, EmailOutcome> OutcomeByEmail(
        IReadOnlyList<SquadMembership> recipients, IReadOnlyList<EmailOutcome> outcomes)
    {
        var map = new Dictionary<string, EmailOutcome>();
        for (int i = 0; i < recipients.Count; i++)
        {
            map[EmailFor(recipients[i].Id)] = outcomes[i];
        }

        return map;
    }

    private static PublishNotificationHandler NewHandler(NotificationStore store, FakeEmailSender sender) =>
        new(
            new FakeNotificationRepository(store),
            new NotificationPublishFakeUnitOfWork(store),
            new FakeNotificationEmailRenderer(),
            sender,
            new CapturingLogger<PublishNotificationHandler>());

    private static DomainResult Publish(PublishNotificationHandler handler, NotificationType type, Guid squadId) =>
        handler
            .PublishAsync(type, squadId, [], Factory.Context(), CancellationToken.None)
            .GetAwaiter()
            .GetResult();

    // True when the entry's formatted message or any structured state value contains the given text.
    private static bool EntryContains(CapturedLogEntry entry, string text)
    {
        if (entry.Message.Contains(text, StringComparison.Ordinal))
        {
            return true;
        }

        return entry.Values.Values.Any(value =>
            value?.ToString()?.Contains(text, StringComparison.Ordinal) == true);
    }

    private static bool EntryHasValue(CapturedLogEntry entry, string key) =>
        entry.Values.ContainsKey(key) && entry.Values[key] is not null;

    // --- Scenario records -------------------------------------------------------------------------

    private sealed record OutcomeScenario(int TypeIndex, IReadOnlyList<EmailOutcome> Outcomes);

    private sealed record FailingSingleRecipient(
        int TypeIndex, EmailOutcome Outcome, string DistinctiveSquadName, string DistinctiveEmail);

    private sealed record DeliverabilityScenario(
        int TypeIndex, bool UseEmptyRatherThanAbsent, IReadOnlyList<bool> Deliverable);
}
