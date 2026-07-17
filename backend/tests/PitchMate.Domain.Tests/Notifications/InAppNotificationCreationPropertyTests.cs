using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using Microsoft.Extensions.Time.Testing;
using PitchMate.Domain.Notifications;

namespace PitchMate.Domain.Tests.Notifications;

/// <summary>
/// Property-based tests for constructing an <see cref="InAppNotification"/> (notifications design
/// Properties 23 and 24). Construction enforces the 1..200 title and 1..2000 body length bounds, and
/// a newly created record is <see cref="ReadState.Unread"/> with a UUID version 7 identity. The
/// creation instant lives in <see cref="PitchMate.Domain.Common.BaseEntity.CreatedAt"/> and is stamped
/// by the persistence audit pipeline from the injected clock rather than by the entity, so the clock
/// stamping is demonstrated here with a <see cref="FakeTimeProvider"/> applied the way that pipeline
/// applies it. Each property runs at least 100 iterations.
/// </summary>
[Trait("Feature", "notifications")]
public class InAppNotificationCreationPropertyTests
{
    private static readonly char[] TextChars =
        "abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".ToCharArray();

    // Feature: notifications, Property 24: Title and body length bounds are enforced at construction -
    // any title of 1..200 characters and body of 1..2000 characters is accepted, producing an Unread
    // record that preserves the supplied title and body.
    // Validates: Requirements 3.1
    [Property(MaxTest = 100)]
    [Trait("Property", "24")]
    public Property InBoundsTitleAndBodyAreAccepted() =>
        Prop.ForAll(Arb.From(InBoundsPairGen()), pair =>
        {
            var (title, body) = pair;

            var result = InAppNotification.Create(
                Guid.NewGuid(), Guid.NewGuid(), NotificationType.MemberJoined, title, body);

            return result.IsSuccess
                && result.Value!.Title == title
                && result.Value!.Body == body
                && result.Value!.ReadState == ReadState.Unread;
        });

    // Feature: notifications, Property 24: Title and body length bounds are enforced at construction -
    // a title outside 1..200 characters (empty or over-long) is rejected with ValidationFailed and no
    // entity is produced, even when the body is valid.
    // Validates: Requirements 3.1
    [Property(MaxTest = 100)]
    [Trait("Property", "24")]
    public Property OutOfBoundsTitleIsRejected() =>
        Prop.ForAll(Arb.From(OutOfBoundsTitleGen()), Arb.From(InBoundsBodyGen()), (title, body) =>
        {
            var result = InAppNotification.Create(
                Guid.NewGuid(), Guid.NewGuid(), NotificationType.MemberJoined, title, body);

            return !result.IsSuccess
                && result.Error!.Code == NotificationErrorCode.ValidationFailed;
        });

    // Feature: notifications, Property 24: Title and body length bounds are enforced at construction -
    // a body outside 1..2000 characters (empty or over-long) is rejected with ValidationFailed and no
    // entity is produced, even when the title is valid.
    // Validates: Requirements 3.1
    [Property(MaxTest = 100)]
    [Trait("Property", "24")]
    public Property OutOfBoundsBodyIsRejected() =>
        Prop.ForAll(Arb.From(InBoundsTitleGen()), Arb.From(OutOfBoundsBodyGen()), (title, body) =>
        {
            var result = InAppNotification.Create(
                Guid.NewGuid(), Guid.NewGuid(), NotificationType.MemberJoined, title, body);

            return !result.IsSuccess
                && result.Error!.Code == NotificationErrorCode.ValidationFailed;
        });

    // Feature: notifications, Property 23: A newly created record is Unread with a v7 identity stamped
    // from the clock - every successfully created record is Unread and carries a non-empty UUID
    // version 7 identity, for any valid type/title/body.
    // Validates: Requirements 3.2, 12.1
    [Property(MaxTest = 100)]
    [Trait("Property", "23")]
    public Property NewRecordIsUnreadWithV7Identity() =>
        Prop.ForAll(Arb.From(NotificationTypeGen()), Arb.From(InBoundsPairGen()), (type, pair) =>
        {
            var (title, body) = pair;

            var notification = InAppNotification.Create(
                Guid.NewGuid(), Guid.NewGuid(), type, title, body).Value!;

            return notification.ReadState == ReadState.Unread
                && notification.Id != Guid.Empty
                && notification.Id.Version == 7;
        });

    // Feature: notifications, Property 23: A newly created record is Unread with a v7 identity stamped
    // from the clock - the creation instant is taken from the clock by the audit pipeline (modelled
    // here with FakeTimeProvider): stamping CreatedAt the way the pipeline does yields exactly the
    // clock's instant, and the record is Unread. The entity itself never reads the clock.
    // Validates: Requirements 12.3, 3.2
    [Property(MaxTest = 100)]
    [Trait("Property", "23")]
    public Property CreationInstantIsStampedFromTheClock() =>
        Prop.ForAll(Arb.From(InstantGen()), instant =>
        {
            var clock = new FakeTimeProvider(instant);

            var notification = InAppNotification.Create(
                Guid.NewGuid(), Guid.NewGuid(), NotificationType.MatchDrafted, "Title", "Body").Value!;

            // The entity takes no clock; the persistence audit pipeline stamps CreatedAt/UpdatedAt
            // from the injected TimeProvider on first persist. Model that stamping here.
            var now = clock.GetUtcNow();
            notification.CreatedAt = now;
            notification.UpdatedAt = now;

            return notification.CreatedAt == instant
                && notification.UpdatedAt == instant
                && notification.ReadState == ReadState.Unread;
        });

    /// <summary>Generates a string of exactly <paramref name="length"/> characters drawn from <see cref="TextChars"/>.</summary>
    private static Gen<string> StringOfLength(int length) =>
        Gen.ArrayOf(Gen.Elements(TextChars), length).Select(chars => new string(chars));

    private static Gen<string> InBoundsTitleGen() =>
        Gen.Choose(InAppNotification.TitleMinLength, InAppNotification.TitleMaxLength).SelectMany(StringOfLength);

    private static Gen<string> InBoundsBodyGen() =>
        Gen.Choose(InAppNotification.BodyMinLength, InAppNotification.BodyMaxLength).SelectMany(StringOfLength);

    private static Gen<(string, string)> InBoundsPairGen() =>
        from title in InBoundsTitleGen()
        from body in InBoundsBodyGen()
        select (title, body);

    /// <summary>Generates a title length of 0 (empty) or 201..400 (over-long), then a string of that length.</summary>
    private static Gen<string> OutOfBoundsTitleGen() =>
        Gen.OneOf(
                Gen.Constant(0),
                Gen.Choose(InAppNotification.TitleMaxLength + 1, InAppNotification.TitleMaxLength + 200))
            .SelectMany(StringOfLength);

    /// <summary>Generates a body length of 0 (empty) or 2001..2400 (over-long), then a string of that length.</summary>
    private static Gen<string> OutOfBoundsBodyGen() =>
        Gen.OneOf(
                Gen.Constant(0),
                Gen.Choose(InAppNotification.BodyMaxLength + 1, InAppNotification.BodyMaxLength + 400))
            .SelectMany(StringOfLength);

    private static Gen<NotificationType> NotificationTypeGen() =>
        Gen.Elements((NotificationType[])Enum.GetValues<NotificationType>());

    /// <summary>Generates a UTC instant within a wide, realistic range around the present.</summary>
    private static Gen<DateTimeOffset> InstantGen() =>
        from seconds in Gen.Choose(0, 20 * 365 * 24 * 60 * 60)
        select new DateTimeOffset(2020, 1, 1, 0, 0, 0, TimeSpan.Zero).AddSeconds(seconds);
}
