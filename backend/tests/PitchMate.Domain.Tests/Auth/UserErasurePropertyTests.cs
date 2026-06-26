using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Domain.Auth;

namespace PitchMate.Domain.Tests.Auth;

/// <summary>
/// Property-based tests for <see cref="User.Anonymise"/> (auth-and-identity design Property 35).
/// Erasure must strip every PII member (display name, email, verification flag, avatar) to fixed,
/// non-identifying placeholders derived only from the non-PII <see cref="User"/> id, while leaving
/// the identity (id) and relationships (the identities collection) unchanged. Each property runs at
/// least 100 iterations over arbitrary initial user state.
/// </summary>
[Trait("Feature", "auth-and-identity")]
public class UserErasurePropertyTests
{
    /// <summary>Letters and digits used to build display names and email-ish bodies (no whitespace).</summary>
    private static readonly char[] TokenChars =
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".ToCharArray();

    /// <summary>An arbitrary initial state for a <see cref="User"/> under test.</summary>
    private sealed record UserValues(string DisplayName, string Email, bool EmailVerified, string? AvatarReference);

    // Feature: auth-and-identity, Property 35: Erasure scrubs PII while preserving identity and
    // relationships - after Anonymise() the id and the identities relationship are unchanged, every
    // PII member holds its fixed placeholder derived from the id, and none of the original
    // identifying content remains. Validates: Requirements 14.1
    [Property(MaxTest = 100)]
    [Trait("Property", "35")]
    public Property ErasureScrubsPiiPreservingIdentityAndRelationships() =>
        Prop.ForAll(Arb.From(UserValuesGen()), values =>
        {
            var user = User.Create(values.DisplayName, values.Email, values.EmailVerified, values.AvatarReference);

            var originalId = user.Id;
            var originalIdentities = user.Identities;
            var originalIdentityCount = user.Identities.Count;
            var originalDisplayName = user.DisplayName;
            var originalEmail = user.Email;

            user.Anonymise();

            // Identity and relationships are unchanged.
            bool identityPreserved = user.Id == originalId;
            bool relationshipsPreserved =
                ReferenceEquals(user.Identities, originalIdentities)
                && user.Identities.Count == originalIdentityCount;

            // PII members now hold their fixed, deterministic placeholders.
            bool piiReplaced =
                user.DisplayName == User.DisplayNamePlaceholder
                && user.Email == $"anonymised+{user.Id:N}@users.invalid"
                && user.EmailVerified == false
                && user.AvatarReference is null;

            // None of the original identifying content remains (allowing the degenerate case where
            // the original display name already equalled the placeholder).
            bool displayNameDeidentified =
                user.DisplayName != originalDisplayName
                || originalDisplayName == User.DisplayNamePlaceholder;
            bool emailDeidentified = user.Email != originalEmail;

            return identityPreserved
                && relationshipsPreserved
                && piiReplaced
                && displayNameDeidentified
                && emailDeidentified;
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
