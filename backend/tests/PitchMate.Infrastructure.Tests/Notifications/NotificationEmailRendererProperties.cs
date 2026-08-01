using FsCheck;
using FsCheck.Xunit;
using PitchMate.Application.Auth.Abstractions;
using PitchMate.Application.Notifications;
using PitchMate.Domain.Notifications;
using PitchMate.Infrastructure.Notifications;

namespace PitchMate.Infrastructure.Tests.Notifications;

/// <summary>
/// Property-based tests for the Infrastructure <see cref="NotificationEmailRenderer"/> covering
/// notifications design Property 22. They drive the real renderer (no database, no fakes) across
/// generated <see cref="NotificationType"/>, recipient address, and <see cref="NotificationContext"/>
/// values, asserting the rendered subject/body format invariants and per-type distinctness.
/// </summary>
[Trait("Feature", "notifications")]
public class NotificationEmailRendererProperties
{
    /// <summary>The maximum subject length permitted for a rendered email (Requirement 7.1).</summary>
    private const int SubjectMaxLength = 200;

    private static readonly NotificationType[] AllTypes = Enum.GetValues<NotificationType>();

    private static readonly NotificationEmailRenderer Renderer = new();

    // Feature: notifications, Property 22: Rendered email subject and body satisfy the format invariants
    // - for any notification type and any rendering context, the rendered email subject is a single line
    // of English text containing no line breaks and at most 200 characters, and the rendered email body is
    // non-empty English text; the submitted EmailMessage carries exactly that rendered subject and body
    // and is addressed to the recipient's email.
    // Validates: Requirements 7.1, 7.3
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(EmailRendererGenerators) })]
    [Trait("Property", "22")]
    public Property Property22_RenderedSubjectAndBodySatisfyFormatInvariants(
        NotificationType type,
        RecipientEmail recipient,
        NotificationContext context)
    {
        EmailMessage message = Renderer.Render(type, recipient.Value, context);

        // The subject is a single line: it contains no carriage-return or line-feed characters.
        bool subjectSingleLine = !message.Subject.Contains('\r') && !message.Subject.Contains('\n');

        // The subject is capped at 200 characters (Requirement 7.1).
        bool subjectWithinLength = message.Subject.Length <= SubjectMaxLength;

        // The body is non-empty English text: at least one non-whitespace character (Requirement 7.1).
        bool bodyNonEmpty = !string.IsNullOrWhiteSpace(message.Body);

        // The message is addressed to exactly the supplied recipient (Requirement 7.3).
        bool addressedToRecipient = string.Equals(message.Recipient, recipient.Value, StringComparison.Ordinal);

        return (subjectSingleLine
            && subjectWithinLength
            && bodyNonEmpty
            && addressedToRecipient).ToProperty();
    }

    // Feature: notifications, Property 22: Rendered email subject and body satisfy the format invariants
    // (distinctness aspect) - for any single rendering context and recipient, no two distinct notification
    // types produce an identical subject or an identical body.
    // Validates: Requirements 7.4
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(EmailRendererGenerators) })]
    [Trait("Property", "22")]
    public Property Property22_DistinctTypesProduceDistinctSubjectsAndBodies(
        RecipientEmail recipient,
        NotificationContext context)
    {
        EmailMessage[] rendered = AllTypes
            .Select(type => Renderer.Render(type, recipient.Value, context))
            .ToArray();

        bool subjectsDistinct = rendered
            .Select(message => message.Subject)
            .Distinct(StringComparer.Ordinal)
            .Count() == rendered.Length;

        bool bodiesDistinct = rendered
            .Select(message => message.Body)
            .Distinct(StringComparer.Ordinal)
            .Count() == rendered.Length;

        return (subjectsDistinct && bodiesDistinct).ToProperty();
    }
}

/// <summary>A generated, non-null recipient email address for the renderer under test.</summary>
public sealed record RecipientEmail(string Value);

/// <summary>
/// FsCheck arbitraries for the email renderer properties. The <see cref="NotificationContext"/> generator
/// constrains the squad-scoped display fields to realistic, bounded shapes — always a present squad name,
/// and optionally-present actor/affected/match fields (including <see langword="null"/>, empty, and
/// whitespace) — including squad names long enough to push the subject past its 200-character budget, so
/// the single-line/length invariants are exercised across the whole input space. It also generates the
/// notification type across all eight members and a bounded recipient address.
/// </summary>
public static class EmailRendererGenerators
{
    private static readonly NotificationType[] AllTypes = Enum.GetValues<NotificationType>();

    /// <summary>Arbitrary for the notification type across all eight catalogue members.</summary>
    public static Arbitrary<NotificationType> NotificationType() => Arb.From(Gen.Elements(AllTypes));

    /// <summary>Arbitrary for a non-null recipient email address.</summary>
    public static Arbitrary<RecipientEmail> RecipientEmail() => Arb.From(RecipientEmailGen());

    /// <summary>Arbitrary for a single notification rendering context.</summary>
    public static Arbitrary<NotificationContext> NotificationContext() => Arb.From(ContextGen());

    private static Gen<RecipientEmail> RecipientEmailGen() =>
        from local in Token()
        select new RecipientEmail($"{local}@example.com");

    private static Gen<NotificationContext> ContextGen() =>
        from squadName in NonNullText()
        from actor in OptionalText()
        from affected in OptionalText()
        from location in OptionalText()
        from scheduled in OptionalOffset()
        from summary in OptionalText()
        select new NotificationContext
        {
            SquadName = squadName,
            ActorDisplayName = actor,
            AffectedMemberDisplayName = affected,
            MatchLocation = location,
            MatchScheduledFor = scheduled,
            MatchSummary = summary,
        };

    // A bounded, always-present text value: normal token, the empty/whitespace edge cases, or a very long
    // value that would exceed the 200-character subject budget before capping.
    private static Gen<string> NonNullText() =>
        Gen.OneOf(
            Token(),
            Gen.Constant(string.Empty),
            Gen.Constant("   "),
            LongToken());

    // An optional text value that may be null, empty, whitespace, or a normal token.
    private static Gen<string?> OptionalText() =>
        Gen.OneOf(
            Token().Select(t => (string?)t),
            Gen.Constant((string?)null),
            Gen.Constant((string?)string.Empty),
            Gen.Constant((string?)"   "));

    private static Gen<DateTimeOffset?> OptionalOffset() =>
        Gen.OneOf(
            Gen.Constant((DateTimeOffset?)null),
            Gen.Choose(0, 3_000_000).Select(minutes =>
                (DateTimeOffset?)new DateTimeOffset(2025, 1, 1, 0, 0, 0, TimeSpan.Zero).AddMinutes(minutes)));

    // A short, human-readable token of length 1..40.
    private static Gen<string> Token() =>
        from length in Gen.Choose(1, 40)
        from chars in Gen.ArrayOf(length, Gen.Elements("abcdefghijklmnopqrstuvwxyz ABCDEF0123456789".ToCharArray()))
        select new string(chars);

    // A long token of length 200..400 to force the subject past its 200-character cap.
    private static Gen<string> LongToken() =>
        from length in Gen.Choose(200, 400)
        from chars in Gen.ArrayOf(length, Gen.Elements("abcdefghijklmnopqrstuvwxyz ABCDEF0123456789".ToCharArray()))
        select new string(chars);
}

