using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Domain.Auth;

namespace PitchMate.Domain.Tests.Auth;

/// <summary>
/// Property-based tests for <see cref="EmailAddress.Create"/> (auth-and-identity design
/// Property 2). Validation must accept exactly the well-formed shapes — a non-empty local part,
/// exactly one <c>@</c>, a domain whose <c>.</c> is neither first nor last, no whitespace, and a
/// total normalised length of at most 254 — and reject everything else. For every accepted input
/// the resulting value equals the canonical <see cref="EmailAddress.Normalise"/> of that input.
/// Each property runs at least 100 iterations over pure, linear generators of valid and invalid
/// shapes.
/// </summary>
[Trait("Feature", "auth-and-identity")]
public class EmailValidationPropertyTests
{
    /// <summary>Letters and digits used to build local parts and domain labels (no whitespace, <c>@</c>, or <c>.</c>).</summary>
    private static readonly char[] TokenChars =
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".ToCharArray();

    // Feature: auth-and-identity, Property 2: Email address validation accepts exactly the valid
    // shapes - a well-formed local-part@domain (with a non-edge dot, no whitespace, total length
    // <= 254) is accepted and its value equals the canonical normalisation of the input.
    // Validates: Requirements 1.1, 2.5
    [Property(MaxTest = 100)]
    [Trait("Property", "2")]
    public Property ValidShapesAreAcceptedAndNormalised() =>
        Prop.ForAll(Arb.From(ValidEmailGen()), raw =>
        {
            var result = EmailAddress.Create(raw);

            return result.IsSuccess
                && result.Value!.Value == EmailAddress.Normalise(raw);
        });

    // Feature: auth-and-identity, Property 2: Email address validation accepts exactly the valid
    // shapes - inputs that violate any structural rule (no '@', empty local part, empty domain,
    // domain without a non-edge dot, internal whitespace, or total length > 254) are rejected.
    // Validates: Requirements 1.1, 2.5
    [Property(MaxTest = 100)]
    [Trait("Property", "2")]
    public Property InvalidShapesAreRejected() =>
        Prop.ForAll(Arb.From(InvalidEmailGen()), raw =>
        {
            var result = EmailAddress.Create(raw);
            return !result.IsSuccess;
        });

    /// <summary>Generates a syntactically valid email, optionally wrapped in surrounding whitespace.</summary>
    private static Gen<string> ValidEmailGen() =>
        from local in TokenGen(1, 20)
        from label1 in TokenGen(1, 20)
        from label2 in TokenGen(1, 20)
        from lead in WhitespaceGen()
        from trail in WhitespaceGen()
        select lead + local + "@" + label1 + "." + label2 + trail;

    /// <summary>Generates one of the canonical invalid shapes, each guaranteed to fail validation.</summary>
    private static Gen<string> InvalidEmailGen() =>
        Gen.OneOf(
            NoAtGen(),
            EmptyLocalGen(),
            EmptyDomainGen(),
            NoDotDomainGen(),
            InternalWhitespaceGen(),
            TooLongGen());

    /// <summary>No <c>@</c> at all.</summary>
    private static Gen<string> NoAtGen() => TokenGen(1, 30);

    /// <summary>Empty local part: <c>@domain</c>.</summary>
    private static Gen<string> EmptyLocalGen() =>
        from label1 in TokenGen(1, 20)
        from label2 in TokenGen(1, 20)
        select "@" + label1 + "." + label2;

    /// <summary>Empty domain: <c>local@</c>.</summary>
    private static Gen<string> EmptyDomainGen() =>
        from local in TokenGen(1, 20)
        select local + "@";

    /// <summary>Domain without a dot: <c>local@domain</c>.</summary>
    private static Gen<string> NoDotDomainGen() =>
        from local in TokenGen(1, 20)
        from domain in TokenGen(1, 20)
        select local + "@" + domain;

    /// <summary>Whitespace inside the address, which survives trimming and is therefore invalid.</summary>
    private static Gen<string> InternalWhitespaceGen() =>
        from localA in TokenGen(1, 10)
        from localB in TokenGen(1, 10)
        from label1 in TokenGen(1, 10)
        from label2 in TokenGen(1, 10)
        select localA + " " + localB + "@" + label1 + "." + label2;

    /// <summary>A well-formed shape whose total length exceeds 254 characters.</summary>
    private static Gen<string> TooLongGen() =>
        from extra in Gen.Choose(0, 50)
        select new string('a', 250 + extra) + "@ex.com";

    /// <summary>Generates a non-empty letters/digits token whose length is within [<paramref name="min"/>, <paramref name="max"/>].</summary>
    private static Gen<string> TokenGen(int min, int max) =>
        from chars in Gen.ListOf(Gen.Elements(TokenChars))
        select Fit(new string(chars.ToArray()), min, max);

    /// <summary>Generates a possibly-empty run of whitespace characters.</summary>
    private static Gen<string> WhitespaceGen() =>
        from chars in Gen.ListOf(Gen.Elements(' ', '\t'))
        select new string(chars.ToArray());

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
