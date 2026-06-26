namespace PitchMate.Domain.Auth;

/// <summary>
/// The password-strength policy applied wherever a plaintext password is supplied —
/// both at registration and when an authenticated user adds a Password-provider
/// sign-in method. The policy is intentionally minimal: it accepts a password if and
/// only if its length falls within the inclusive bounds <see cref="MinLength"/> to
/// <see cref="MaxLength"/>.
/// <para>
/// The method is pure and free of framework types so that every caller — registration
/// and add-password-method alike — shares one definition of an acceptable password.
/// </para>
/// </summary>
public static class PasswordPolicy
{
    /// <summary>The minimum acceptable plaintext password length, in characters, inclusive.</summary>
    public const int MinLength = 12;

    /// <summary>The maximum acceptable plaintext password length, in characters, inclusive.</summary>
    public const int MaxLength = 128;

    /// <summary>
    /// Determines whether <paramref name="plaintext"/> satisfies the password-strength
    /// policy. A password is acceptable if and only if it is non-null and its length is
    /// within the inclusive range [<see cref="MinLength"/>, <see cref="MaxLength"/>].
    /// </summary>
    /// <param name="plaintext">The candidate plaintext password, which may be <see langword="null"/>.</param>
    /// <returns>
    /// <see langword="true"/> when the password is non-null and its length is within the
    /// inclusive bounds; otherwise <see langword="false"/>. A <see langword="null"/>
    /// password returns <see langword="false"/>.
    /// </returns>
    public static bool IsAcceptable(string? plaintext) =>
        plaintext is not null
        && plaintext.Length >= MinLength
        && plaintext.Length <= MaxLength;
}
