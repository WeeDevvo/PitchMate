using FsCheck;
using FsCheck.Fluent;
using PitchMate.Domain.Auth;

namespace PitchMate.Application.Tests.Auth.PasswordReset;

/// <summary>
/// FsCheck generators shared by the password-reset property tests. Prefixed and folder-scoped
/// so they never collide with generators authored by sibling test tasks in this project.
/// </summary>
internal static class PasswordResetGenerators
{
    private static readonly char[] AlphaNumeric =
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".ToCharArray();

    private static readonly char[] LowerAlphaNumeric =
        "abcdefghijklmnopqrstuvwxyz0123456789".ToCharArray();

    /// <summary>
    /// A plaintext password that satisfies <see cref="PasswordPolicy"/>: a non-whitespace
    /// string whose length is within the inclusive bounds [12, 128].
    /// </summary>
    public static Gen<string> PolicyCompliantPassword() =>
        from len in Gen.Choose(PasswordPolicy.MinLength, PasswordPolicy.MaxLength)
        from chars in Gen.ListOf(Gen.Elements(AlphaNumeric))
        select Fit(new string(chars.ToArray()), len, len);

    /// <summary>
    /// A plaintext password that violates <see cref="PasswordPolicy"/> by length: either too
    /// short (0-11 characters) or too long (129-200 characters).
    /// </summary>
    public static Gen<string> PolicyViolatingPassword() =>
        from tooLong in Gen.Elements(true, false)
        from len in tooLong
            ? Gen.Choose(PasswordPolicy.MaxLength + 1, 200)
            : Gen.Choose(0, PasswordPolicy.MinLength - 1)
        from chars in Gen.ListOf(Gen.Elements(AlphaNumeric))
        select Fit(new string(chars.ToArray()), len, len);

    /// <summary>A non-empty opaque reset-token secret (8-40 characters).</summary>
    public static Gen<string> TokenSecret() =>
        from chars in Gen.ListOf(Gen.Elements(AlphaNumeric))
        select Fit("t" + new string(chars.ToArray()), 8, 40);

    /// <summary>
    /// A raw email address that <see cref="EmailAddress.Create"/> accepts. Generated in lower
    /// case so the raw value equals its normalised form.
    /// </summary>
    public static Gen<string> ValidEmail() =>
        from local in Gen.ListOf(Gen.Elements(LowerAlphaNumeric))
        from label in Gen.ListOf(Gen.Elements(LowerAlphaNumeric))
        select Fit("a" + new string(local.ToArray()), 1, 24)
             + "@"
             + Fit("a" + new string(label.ToArray()), 1, 20)
             + ".com";

    /// <summary>
    /// Clamps <paramref name="s"/> to a length within [<paramref name="min"/>, <paramref name="max"/>],
    /// truncating when too long and padding with 'a' when too short.
    /// </summary>
    private static string Fit(string s, int min, int max)
    {
        if (s.Length > max)
        {
            s = s[..max];
        }

        if (s.Length < min)
        {
            s += new string('a', min - s.Length);
        }

        return s;
    }
}
