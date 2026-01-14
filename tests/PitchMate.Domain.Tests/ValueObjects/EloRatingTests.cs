using FluentAssertions;
using PitchMate.Domain.ValueObjects;

namespace PitchMate.Domain.Tests.ValueObjects;

public class EloRatingTests
{
    [Fact]
    public void EloRating_WithValidValue_ShouldCreateSuccessfully()
    {
        // Arrange
        var validRating = 1500;

        // Act
        var eloRating = EloRating.Create(validRating);

        // Assert
        eloRating.Value.Should().Be(validRating);
    }

    [Fact]
    public void EloRating_Default_ShouldBe1000()
    {
        // Act
        var defaultRating = EloRating.Default;

        // Assert
        defaultRating.Value.Should().Be(1000);
    }

    [Theory]
    [InlineData(399)]  // Below minimum
    [InlineData(2401)] // Above maximum
    [InlineData(0)]
    [InlineData(-100)]
    [InlineData(3000)]
    public void EloRating_WithInvalidValue_ShouldThrowArgumentException(int invalidRating)
    {
        // Act
        var act = () => EloRating.Create(invalidRating);

        // Assert
        act.Should().Throw<ArgumentException>()
            .WithMessage("ELO rating must be between 400 and 2400.*");
    }

    [Theory]
    [InlineData(400)]  // Minimum
    [InlineData(2400)] // Maximum
    [InlineData(1000)] // Default
    [InlineData(1500)] // Mid-range
    public void EloRating_WithBoundaryValues_ShouldCreateSuccessfully(int rating)
    {
        // Act
        var eloRating = EloRating.Create(rating);

        // Assert
        eloRating.Value.Should().Be(rating);
    }

    [Fact]
    public void EloRating_Add_ShouldIncreaseRating()
    {
        // Arrange
        var rating = EloRating.Create(1000);

        // Act
        var newRating = rating.Add(50);

        // Assert
        newRating.Value.Should().Be(1050);
    }

    [Fact]
    public void EloRating_Add_WhenExceedsMaximum_ShouldClampToMaximum()
    {
        // Arrange
        var rating = EloRating.Create(2350);

        // Act
        var newRating = rating.Add(100);

        // Assert
        newRating.Value.Should().Be(2400);
    }

    [Fact]
    public void EloRating_Add_WithNegativeChange_ShouldDecreaseRating()
    {
        // Arrange
        var rating = EloRating.Create(1000);

        // Act
        var newRating = rating.Add(-50);

        // Assert
        newRating.Value.Should().Be(950);
    }

    [Fact]
    public void EloRating_Add_WhenBelowMinimum_ShouldClampToMinimum()
    {
        // Arrange
        var rating = EloRating.Create(450);

        // Act
        var newRating = rating.Add(-100);

        // Assert
        newRating.Value.Should().Be(400);
    }

    [Fact]
    public void EloRating_Subtract_ShouldDecreaseRating()
    {
        // Arrange
        var rating = EloRating.Create(1000);

        // Act
        var newRating = rating.Subtract(50);

        // Assert
        newRating.Value.Should().Be(950);
    }

    [Fact]
    public void EloRating_Subtract_WhenBelowMinimum_ShouldClampToMinimum()
    {
        // Arrange
        var rating = EloRating.Create(450);

        // Act
        var newRating = rating.Subtract(100);

        // Assert
        newRating.Value.Should().Be(400);
    }

    [Fact]
    public void EloRating_Equality_ShouldWorkCorrectly()
    {
        // Arrange
        var rating1 = EloRating.Create(1500);
        var rating2 = EloRating.Create(1500);
        var rating3 = EloRating.Create(1600);

        // Assert
        rating1.Should().Be(rating2);
        rating1.Should().NotBe(rating3);
    }

    [Fact]
    public void EloRating_Immutability_ShouldPreventModification()
    {
        // Arrange
        var originalRating = EloRating.Create(1000);

        // Act
        var newRating = originalRating.Add(50);

        // Assert
        originalRating.Value.Should().Be(1000); // Original unchanged
        newRating.Value.Should().Be(1050);      // New instance created
    }

    [Fact]
    public void EloRating_ArithmeticOperations_ShouldBeChainable()
    {
        // Arrange
        var rating = EloRating.Create(1000);

        // Act
        var result = rating.Add(100).Subtract(50).Add(25);

        // Assert
        result.Value.Should().Be(1075);
    }
}
