using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Domain.Auth;

namespace PitchMate.Domain.Tests.Auth;

/// <summary>
/// Property-based tests for <see cref="PasswordPolicy.IsAcceptable"/> (auth-and-identity design
/// Property 3). A plaintext password is acceptable if and only if it is non-null and its length is
/// within the inclusive bounds [<see cref="PasswordPolicy.MinLength"/>,
/// <see cref="PasswordPolicy.MaxLength"/>]. The generator deliberately concentrates on the
/// boundary lengths (11/12/128/129) and the null case while still covering a broad length range,
/// running at least 100 iterations.
/// </summary>
[Trait("Feature", "auth-and-identity")]
public class PasswordPolicyPropertyTests
{
    // Feature: auth-and-identity, Property 3: Password length policy - IsAcceptable(p) is true
    // exactly when p is non-null and 12 <= p.Length <= 128, exercised across arbitrary lengths and
    // the 11/12/128/129 boundaries. Validates: Requirements 2.4, 10.10
    [Property(MaxTest = 100)]
    [Trait("Property", "3")]
    public Property PasswordIsAcceptableExactlyWithinLengthBounds() =>
        Prop.ForAll(Arb.From(CandidatePasswordGen()), password =>
        {
            bool expected =
                password is not null
                && password.Length >= PasswordPolicy.MinLength
                && password.Length <= PasswordPolicy.MaxLength;

            return PasswordPolicy.IsAcceptable(password) == expected;
        });

    /// <summary>
    /// Generates a candidate password: sometimes <see langword="null"/>, otherwise a string of a
    /// chosen length. Lengths are drawn from the policy boundaries and a broad surrounding range.
    /// </summary>
    private static Gen<string?> CandidatePasswordGen() =>
        Gen.OneOf(
            Gen.Constant<string?>(null),
            LengthGen().Select(len => (string?)new string('x', len)));

    /// <summary>Generates a string length focused on the policy boundaries plus a broad range.</summary>
    private static Gen<int> LengthGen() =>
        Gen.OneOf(
            Gen.Elements(0, 1, 11, 12, 13, 127, 128, 129),
            Gen.Choose(0, 300));
}
