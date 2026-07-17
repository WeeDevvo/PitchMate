using PitchMate.Domain.Notifications;
using Xunit;

namespace PitchMate.Domain.Tests.Notifications;

/// <summary>
/// Unit tests for read-state transitions on <see cref="InAppNotification"/> (notifications tasks 1.4).
/// The only permitted change is towards <see cref="ReadState.Read"/>: an unread record becomes read,
/// re-marking a read record is an idempotent success, and any attempt to revert a read record to
/// unread is rejected with a typed failure that leaves the record read
/// (Requirements 3.4, 3.5, 3.8).
/// </summary>
[Trait("Feature", "notifications")]
public class InAppNotificationMarkReadTests
{
    private static InAppNotification NewNotification() =>
        InAppNotification.Create(
            Guid.NewGuid(),
            Guid.NewGuid(),
            NotificationType.MemberJoined,
            "You have a notification",
            "Something happened in your squad.").Value!;

    [Fact]
    public void MarkRead_FromUnread_SetsReadAndSucceeds()
    {
        var notification = NewNotification();
        Assert.Equal(ReadState.Unread, notification.ReadState);

        var result = notification.MarkRead();

        Assert.True(result.IsSuccess);
        Assert.Null(result.Error);
        Assert.Equal(ReadState.Read, notification.ReadState);
    }

    [Fact]
    public void MarkRead_WhenAlreadyRead_IsIdempotentSuccess()
    {
        var notification = NewNotification();
        Assert.True(notification.MarkRead().IsSuccess);

        var result = notification.MarkRead();

        Assert.True(result.IsSuccess);
        Assert.Null(result.Error);
        Assert.Equal(ReadState.Read, notification.ReadState);
    }

    [Fact]
    public void TransitionTo_ReadFromUnread_SetsReadAndSucceeds()
    {
        var notification = NewNotification();

        var result = notification.TransitionTo(ReadState.Read);

        Assert.True(result.IsSuccess);
        Assert.Equal(ReadState.Read, notification.ReadState);
    }

    [Fact]
    public void TransitionTo_UnreadFromRead_IsRejectedAndLeavesRecordRead()
    {
        var notification = NewNotification();
        Assert.True(notification.MarkRead().IsSuccess);

        var result = notification.TransitionTo(ReadState.Unread);

        Assert.False(result.IsSuccess);
        Assert.NotNull(result.Error);
        Assert.Equal(NotificationErrorCode.InvalidReadStateTransition, result.Error!.Code);
        Assert.Equal(ReadState.Read, notification.ReadState);
    }

    [Fact]
    public void TransitionTo_UnreadFromUnread_IsNoOpSuccess()
    {
        var notification = NewNotification();

        var result = notification.TransitionTo(ReadState.Unread);

        Assert.True(result.IsSuccess);
        Assert.Equal(ReadState.Unread, notification.ReadState);
    }
}
