using PitchMate.Domain.LiveTracking;

namespace PitchMate.Domain.Tests.LiveTracking;

/// <summary>
/// Boundary unit tests for the <see cref="MatchMinute"/> factory (Requirement 3.6, 4.5). The factory
/// accepts a whole minute in the inclusive range [0, 200] and returns a validation failure for a
/// value below or above that range.
/// </summary>
[Trait("Feature", "live-tracking")]
public class MatchMinuteTests
{
    [Theory]
    [InlineData(0)]
    [InlineData(200)]
    public void Create_WithinInclusiveRange_Succeeds(int minute)
    {
        Result<MatchMinute> result = MatchMinute.Create(minute);

        Assert.True(result.IsSuccess);
        Assert.Null(result.Error);
        Assert.Equal(minute, result.Value.Value);
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(201)]
    public void Create_OutsideInclusiveRange_FailsValidation(int minute)
    {
        Result<MatchMinute> result = MatchMinute.Create(minute);

        Assert.False(result.IsSuccess);
        Assert.NotNull(result.Error);
        Assert.Equal(LiveTrackingErrorCode.ValidationFailed, result.Error!.Code);
    }
}
