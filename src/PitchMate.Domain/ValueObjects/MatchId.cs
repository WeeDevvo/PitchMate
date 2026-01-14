namespace PitchMate.Domain.ValueObjects;

/// <summary>
/// Strongly-typed identifier for Match entities.
/// Ensures type safety and prevents mixing different ID types.
/// </summary>
public record MatchId
{
    public Guid Value { get; init; }

    public MatchId(Guid value)
    {
        if (value == Guid.Empty)
        {
            throw new ArgumentException("MatchId cannot be empty.", nameof(value));
        }

        Value = value;
    }

    public static MatchId NewId() => new(Guid.NewGuid());

    public override string ToString() => Value.ToString();
}
