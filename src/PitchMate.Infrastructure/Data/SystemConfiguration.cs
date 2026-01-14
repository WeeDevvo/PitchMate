namespace PitchMate.Infrastructure.Data;

/// <summary>
/// Entity representing a system configuration key-value pair.
/// Maps to the system_configuration table.
/// </summary>
public class SystemConfiguration
{
    public string Key { get; set; } = null!;
    public string Value { get; set; } = null!;
    public DateTime UpdatedAt { get; set; }
}
