namespace PitchMate.Domain.ValueObjects;

/// <summary>
/// Strongly-typed identifier for User entities.
/// Ensures type safety and prevents mixing different ID types.
/// </summary>
public record UserId
{
    public Guid Value { get; init; }

    public UserId(Guid value)
    {
        if (value == Guid.Empty)
        {
            throw new ArgumentException("UserId cannot be empty.", nameof(value));
        }

        Value = value;
    }

    public static UserId NewId() => new(Guid.NewGuid());

    public override string ToString() => Value.ToString();
}
