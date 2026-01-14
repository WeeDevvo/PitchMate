namespace PitchMate.Domain.ValueObjects;

/// <summary>
/// Strongly-typed identifier for Squad entities.
/// Ensures type safety and prevents mixing different ID types.
/// </summary>
public record SquadId
{
    public Guid Value { get; init; }

    public SquadId(Guid value)
    {
        if (value == Guid.Empty)
        {
            throw new ArgumentException("SquadId cannot be empty.", nameof(value));
        }

        Value = value;
    }

    public static SquadId NewId() => new(Guid.NewGuid());

    public override string ToString() => Value.ToString();
}
