using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Domain.Auth;

namespace PitchMate.Domain.Tests.Auth;

/// <summary>
/// Property-based tests for the idempotence of <see cref="User.Anonymise"/> (auth-and-identity
/// design Property 37). Applying erasure a second and third time must complete without error and
/// leave each PII member holding exactly the same fixed placeholder produced by the first
/// application, so the state after N>=1 applications equals the state after exactly one. Each
/// property runs at least 100 iterations over arbitrary initial user state.
/// </summary>
[Trait("Feature", "auth-and-identity")]
public class UserErasureIdempotencePropertyTests
{
    /// <summary>Letters and digits used to build display names and email-ish bodies (no whitespace).</summary>
    private static readonly char[] TokenChars =
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".ToCharArray();

    /// <summary>An arbitrary initial state for a <see cref="User"/> under test.</summary>
    private sealed record UserValues(string DisplayName, string Email, bool EmailVerified, string? AvatarReference);

    // Feature: auth-and-identity, Property 37: Erasure is idempotent - the PII members after the
    // first Anonymise() match the deterministic placeholders, and applying it again twice leaves
    // those four members unchanged. Validates: Requirements 14.5
    [Property(MaxTest = 100)]
    [Trait("Property", "37")]
    public Property ErasureIsIdempotent() =>
        Prop.ForAll(Arb.From(UserValuesGen()), values =>
        {
            var user = User.Create(values.DisplayName, values.Email, values.EmailVerified, values.AvatarReference);

            user.Anonymise();
            var displayAfterFirst = user.DisplayName;
            var emailAfterFirst = user.Email;
            var verifiedAfterFirst = user.EmailVerified;
            var avatarAfterFirst = user.AvatarReference;

            // Re-applying must be a safe no-op that leaves the placeholders in place.
            user.Anonymise();
            user.Anonymise();

            bool stableAcrossReapplication =
                user.DisplayName == displayAfterFirst
                && user.Email == emailAfterFirst
                && user.EmailVerified == verifiedAfterFirst
                && user.AvatarReference == avatarAfterFirst;

            bool matchesDeterministicPlaceholders =
                user.DisplayName == User.DisplayNamePlaceholder
                && user.Email == $"anonymised+{user.Id:N}@users.invalid"
                && user.EmailVerified == false
                && user.AvatarReference is null;

            return stableAcrossReapplication && matchesDeterministicPlaceholders;
        });

    /// <summary>Generates arbitrary initial user state with a valid display name, non-empty email, and optional avatar.</summary>
    private static Gen<UserValues> UserValuesGen() =>
        from displayName in DisplayNameGen()
        from email in EmailBodyGen()
        from emailVerified in Gen.Elements(true, false)
        from avatar in OptionalTokenGen()
        select new UserValues(displayName, email, emailVerified, avatar);

    /// <summary>Generates a 1–100 character display name of letters/digits (always non-whitespace).</summary>
    private static Gen<string> DisplayNameGen() =>
        from chars in Gen.ListOf(Gen.Elements(TokenChars))
        select Fit("a" + new string(chars.ToArray()), 1, 100);

    /// <summary>Generates a non-empty, non-whitespace email-ish body used as the user's contact email.</summary>
    private static Gen<string> EmailBodyGen() =>
        from local in Gen.ListOf(Gen.Elements(TokenChars))
        from label in Gen.ListOf(Gen.Elements(TokenChars))
        select Fit("a" + new string(local.ToArray()), 1, 30) + "@" + Fit("a" + new string(label.ToArray()), 1, 20) + ".test";

    /// <summary>Generates an optional avatar reference: either <see langword="null"/> or a non-empty token.</summary>
    private static Gen<string?> OptionalTokenGen() =>
        Gen.OneOf(
            Gen.Constant<string?>(null),
            (from chars in Gen.ListOf(Gen.Elements(TokenChars))
             select (string?)Fit("a" + new string(chars.ToArray()), 1, 40)));

    /// <summary>Clamps <paramref name="s"/> to a length within [<paramref name="min"/>, <paramref name="max"/>], padding with 'a' when too short.</summary>
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
