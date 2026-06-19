using PitchMate.Domain.Rating;

namespace PitchMate.Infrastructure.Tests.Domain;

/// <summary>
/// Verifies that <see cref="Result{T}"/> factory helpers carry the success value versus the
/// failure error correctly across representative value types (Requirements 11.3, 11.4).
/// </summary>
public class ResultTests
{
    [Fact]
    public void Ok_WithRating_IsSuccessAndCarriesValue()
    {
        var rating = new Rating(25.0, 25.0 / 3.0);

        var result = Result<Rating>.Ok(rating);

        Assert.True(result.IsSuccess);
        Assert.Equal(rating, result.Value);
        Assert.Null(result.Error);
    }

    [Fact]
    public void Ok_WithInt_IsSuccessAndCarriesValue()
    {
        var result = Result<int>.Ok(42);

        Assert.True(result.IsSuccess);
        Assert.Equal(42, result.Value);
        Assert.Null(result.Error);
    }

    [Fact]
    public void Fail_WithRating_IsFailureAndCarriesError()
    {
        var error = new RatingError(RatingErrorCode.NonPositiveSigma, "sigma must be positive");

        var result = Result<Rating>.Fail(error);

        Assert.False(result.IsSuccess);
        Assert.Equal(error, result.Error);
        Assert.Equal(default, result.Value);
    }

    [Fact]
    public void Fail_WithInt_IsFailureAndValueIsDefault()
    {
        var error = new RatingError(RatingErrorCode.TooFewTeams, "need at least two teams");

        var result = Result<int>.Fail(error);

        Assert.False(result.IsSuccess);
        Assert.Equal(error, result.Error);
        Assert.Equal(0, result.Value);
    }

    [Fact]
    public void Fail_WithReferenceType_HasNullValue()
    {
        var error = new RatingError(RatingErrorCode.InvalidConfiguration, "bad config");

        var result = Result<string>.Fail(error);

        Assert.False(result.IsSuccess);
        Assert.Equal(error, result.Error);
        Assert.Null(result.Value);
    }
}
