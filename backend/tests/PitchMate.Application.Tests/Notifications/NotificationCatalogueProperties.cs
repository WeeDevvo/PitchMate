using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Application.Notifications;
using PitchMate.Domain.Notifications;

namespace PitchMate.Application.Tests.Notifications;

/// <summary>
/// Property-based test for the <see cref="NotificationCatalogue"/> covering notifications design
/// Property 21. It drives the real static catalogue (no database, no fakes) across generated
/// <see cref="NotificationContext"/> values, asserting the catalogue is total over the eight
/// <see cref="NotificationType"/> members and renders distinct in-app content per type.
/// </summary>
[Trait("Feature", "notifications")]
public class NotificationCatalogueProperties
{
    private static readonly NotificationType[] AllTypes = Enum.GetValues<NotificationType>();

    // Feature: notifications, Property 21: The catalogue is complete and produces distinct content per
    // type - for any rendering context, every one of the eight notification types is recognised, maps to
    // exactly one targeting rule, and renders a valid in-app title/body; and across the eight types no
    // two distinct types produce an identical title or an identical body.
    // Validates: Requirements 2.2, 2.3, 7.4
    [Property(MaxTest = 200, Arbitrary = new[] { typeof(NotificationContextGenerators) })]
    [Trait("Property", "21")]
    public Property Property21_CatalogueIsCompleteAndContentIsDistinct(NotificationContext context)
    {
        // Completeness: exactly the eight defined members, each recognised with exactly one rule and
        // renderable content (Requirements 2.2, 2.3).
        bool exactlyEight = AllTypes.Length == 8;

        bool everyTypeRecognised = AllTypes.All(NotificationCatalogue.IsRecognised);

        bool everyTypeHasOneRule = AllTypes.All(type =>
        {
            TargetingRule rule = NotificationCatalogue.GetTargetingRule(type);
            return rule is TargetingRule.Broadcast or TargetingRule.Directed;
        });

        // The targeting rule matches the design table: squad events directed, match-lifecycle broadcast.
        bool rulesMatchDesign =
            NotificationCatalogue.GetTargetingRule(NotificationType.MemberJoined) == TargetingRule.Directed
            && NotificationCatalogue.GetTargetingRule(NotificationType.PromotedToAdmin) == TargetingRule.Directed
            && NotificationCatalogue.GetTargetingRule(NotificationType.RemovedFromSquad) == TargetingRule.Directed
            && NotificationCatalogue.GetTargetingRule(NotificationType.OwnershipTransferred) == TargetingRule.Directed
            && NotificationCatalogue.GetTargetingRule(NotificationType.MatchDrafted) == TargetingRule.Broadcast
            && NotificationCatalogue.GetTargetingRule(NotificationType.MatchConfirmed) == TargetingRule.Broadcast
            && NotificationCatalogue.GetTargetingRule(NotificationType.TeamsRolled) == TargetingRule.Broadcast
            && NotificationCatalogue.GetTargetingRule(NotificationType.ResultPosted) == TargetingRule.Broadcast;

        NotificationContent[] rendered = AllTypes
            .Select(type => NotificationCatalogue.RenderInAppContent(type, context))
            .ToArray();

        // Each rendered title/body is valid for the InAppNotification length bounds (Requirement 2.3).
        bool contentWithinBounds = rendered.All(content =>
            content.Title.Length is >= InAppNotification.TitleMinLength and <= InAppNotification.TitleMaxLength
            && content.Body.Length is >= InAppNotification.BodyMinLength and <= InAppNotification.BodyMaxLength);

        // Distinctness: no two distinct types share a title or share a body (Requirement 7.4).
        bool titlesDistinct = rendered.Select(c => c.Title).Distinct(StringComparer.Ordinal).Count() == rendered.Length;
        bool bodiesDistinct = rendered.Select(c => c.Body).Distinct(StringComparer.Ordinal).Count() == rendered.Length;

        return (exactlyEight
            && everyTypeRecognised
            && everyTypeHasOneRule
            && rulesMatchDesign
            && contentWithinBounds
            && titlesDistinct
            && bodiesDistinct).ToProperty();
    }
}

/// <summary>
/// FsCheck arbitraries for <see cref="NotificationContext"/>. The generator constrains the squad-scoped
/// display fields to realistic, bounded shapes — always a present squad name, and optionally-present
/// actor/affected/match fields (including <see langword="null"/>) — so the catalogue's rendering is
/// exercised across the whole input space, including empty and whitespace values, without producing
/// content that would exceed the in-app length bounds.
/// </summary>
public static class NotificationContextGenerators
{
    /// <summary>Arbitrary for a single notification rendering context.</summary>
    public static Arbitrary<NotificationContext> NotificationContext() => Arb.From(ContextGen());

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

    // A bounded, always-present text value: normal token, or the empty/whitespace edge cases.
    private static Gen<string> NonNullText() =>
        Gen.OneOf(
            Token(),
            Gen.Constant(string.Empty),
            Gen.Constant("   "));

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
        from chars in Gen.ArrayOf(Gen.Elements("abcdefghijklmnopqrstuvwxyz ABCDEF0123456789".ToCharArray()), length)
        select new string(chars);
}
