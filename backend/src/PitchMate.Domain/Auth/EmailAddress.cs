using PitchMate.Domain.Rating;

namespace PitchMate.Domain.Auth;

/// <summary>
/// A normalised email address. The value object encapsulates the single canonical
/// normalisation rule (<see cref="Normalise"/>) and the validation rule
/// (<see cref="Create"/>) so both are defined once and reused everywhere an email is
/// compared, stored, or matched. The contained <see cref="Value"/> is always the
/// normalised form, so two addresses that differ only by letter case or surrounding
/// whitespace produce equal <see cref="EmailAddress"/> instances.
/// </summary>
public sealed record EmailAddress
{
    /// <summary>The maximum permitted total length of a normalised email address.</summary>
    private const int MaxLength = 254;

    /// <summary>The normalised email address value.</summary>
    public string Value { get; }

    private EmailAddress(string value) => Value = value;

    /// <summary>
    /// Produces the canonical normalised form of <paramref name="raw"/> by trimming
    /// leading and trailing whitespace and lower-casing all letters using the invariant
    /// culture. This is the definition of "normalise" referenced throughout the auth
    /// system, so values differing only by case or surrounding whitespace collapse to a
    /// single normalised string.
    /// </summary>
    /// <param name="raw">The raw email input.</param>
    /// <returns>The normalised email string.</returns>
    public static string Normalise(string raw) => raw.Trim().ToLowerInvariant();

    /// <summary>
    /// Normalises <paramref name="raw"/> and validates it as a syntactically valid
    /// address of the form <c>local-part@domain</c> whose total length does not exceed
    /// 254 characters. Returns a success carrying the normalised <see cref="EmailAddress"/>,
    /// or a validation failure otherwise. Never throws for an invalid input.
    /// </summary>
    /// <param name="raw">The raw email input, which may be <see langword="null"/>.</param>
    /// <returns>A successful result with the normalised address, or a validation failure.</returns>
    public static Result<EmailAddress> Create(string? raw)
    {
        if (raw is null)
        {
            return Invalid();
        }

        string normalised = Normalise(raw);

        return IsValid(normalised)
            ? Result<EmailAddress>.Ok(new EmailAddress(normalised))
            : Invalid();
    }

    /// <summary>
    /// Determines whether <paramref name="normalised"/> is a syntactically valid email
    /// of the form <c>local-part@domain</c>: a non-empty local part, exactly one
    /// <c>@</c>, a non-empty domain containing at least one <c>.</c>, no whitespace, and
    /// a total length within the permitted bound. Kept pure and linear so there is no
    /// risk of catastrophic backtracking.
    /// </summary>
    private static bool IsValid(string normalised)
    {
        if (normalised.Length is 0 or > MaxLength)
        {
            return false;
        }

        int atIndex = normalised.IndexOf('@');

        // Exactly one '@', with content on both sides.
        if (atIndex <= 0 || atIndex != normalised.LastIndexOf('@') || atIndex == normalised.Length - 1)
        {
            return false;
        }

        string domain = normalised[(atIndex + 1)..];

        // Domain must contain a dot that is neither the first nor the last character.
        int dotIndex = domain.IndexOf('.');
        if (dotIndex <= 0 || dotIndex == domain.Length - 1)
        {
            return false;
        }

        // No whitespace anywhere in the address.
        foreach (char c in normalised)
        {
            if (char.IsWhiteSpace(c))
            {
                return false;
            }
        }

        return true;
    }

    private static Result<EmailAddress> Invalid() =>
        Result<EmailAddress>.Fail(new RatingError(
            RatingErrorCode.InvalidRosterInput,
            "The email address is not a valid local-part@domain value of at most 254 characters."));
}
