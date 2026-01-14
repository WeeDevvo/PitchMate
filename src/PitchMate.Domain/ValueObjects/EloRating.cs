namespace PitchMate.Domain.ValueObjects;

/// <summary>
/// ELO rating value object with range validation.
/// Valid range is 400-2400 based on standard ELO rating systems.
/// </summary>
public record EloRating
{
    public const int MinRating = 400;
    public const int MaxRating = 2400;
    public const int DefaultRating = 1000;

    public int Value { get; init; }

    private EloRating(int value)
    {
        Value = value;
    }

    public static EloRating Create(int value)
    {
        if (value < MinRating || value > MaxRating)
        {
            throw new ArgumentException(
                $"ELO rating must be between {MinRating} and {MaxRating}. Provided: {value}",
                nameof(value));
        }

        return new EloRating(value);
    }

    public static EloRating Default => new(DefaultRating);

    /// <summary>
    /// Adds a rating change to the current rating.
    /// Ensures the result stays within valid bounds.
    /// </summary>
    public EloRating Add(int change)
    {
        var newValue = Value + change;
        
        // Clamp to valid range
        if (newValue < MinRating)
            newValue = MinRating;
        if (newValue > MaxRating)
            newValue = MaxRating;

        return new EloRating(newValue);
    }

    /// <summary>
    /// Subtracts a rating change from the current rating.
    /// Ensures the result stays within valid bounds.
    /// </summary>
    public EloRating Subtract(int change)
    {
        return Add(-change);
    }

    public override string ToString() => Value.ToString();
}
