using System.Text.RegularExpressions;

namespace PitchMate.Domain.ValueObjects;

/// <summary>
/// Email value object with format validation.
/// Ensures all email addresses in the system are valid.
/// </summary>
public record Email
{
    private static readonly Regex EmailRegex = new(
        @"^[^@\s]+@[^@\s]+\.[^@\s]+$",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    public string Value { get; init; }

    private Email(string value)
    {
        Value = value;
    }

    public static Email Create(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new ArgumentException("Email cannot be empty.", nameof(value));
        }

        var trimmedValue = value.Trim();

        if (!EmailRegex.IsMatch(trimmedValue))
        {
            throw new ArgumentException($"Invalid email format: {value}", nameof(value));
        }

        return new Email(trimmedValue.ToLowerInvariant());
    }

    public override string ToString() => Value;
}
