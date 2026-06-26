using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Domain.Auth;

namespace PitchMate.Domain.Tests.Auth;

/// <summary>
/// Property-based tests for <see cref="EmailAddress.Normalise"/> (auth-and-identity design
/// Property 1). Normalisation trims surrounding whitespace and lower-cases every letter, so it
/// must be canonical (no surrounding whitespace, no upper-case letters), idempotent, and blind to
/// differences of letter case and surrounding whitespace. Each property runs at least 100
/// iterations over arbitrary raw input drawn from a representative ASCII character set that
/// includes whitespace, mixed case, digits, and the structural <c>@</c>/<c>.</c> characters.
/// </summary>
[Trait("Feature", "auth-and-identity")]
public class EmailNormalisationPropertyTests
{
    /// <summary>Characters used to build arbitrary raw inputs: mixed-case letters, digits, whitespace, and structure.</summary>
    private static readonly char[] RawChars = "abcdefghijABCDEFGHIJ0123456789 \t@.".ToCharArray();

    /// <summary>Non-whitespace characters used to build a stable "core" address body.</summary>
    private static readonly char[] CoreChars = "abcdefghijABCDEFGHIJ0123456789@.".ToCharArray();

    // Feature: auth-and-identity, Property 1: Email normalisation is canonical and idempotent - for
    // any raw input, Normalise produces a value with no leading/trailing whitespace and no
    // upper-case letters (canonical), and applying Normalise again leaves it unchanged (idempotent).
    // Validates: Requirements 2.7
    [Property(MaxTest = 100)]
    [Trait("Property", "1")]
    public Property NormalisationIsCanonicalAndIdempotent() =>
        Prop.ForAll(Arb.From(RawGen()), raw =>
        {
            string normalised = EmailAddress.Normalise(raw);

            bool idempotent = EmailAddress.Normalise(normalised) == normalised;
            bool noSurroundingWhitespace = normalised == normalised.Trim();
            bool noUpperCase = !normalised.Any(char.IsUpper);

            return idempotent && noSurroundingWhitespace && noUpperCase;
        });

    // Feature: auth-and-identity, Property 1: Email normalisation is canonical and idempotent -
    // inputs differing only by letter case and surrounding whitespace normalise to the same value.
    // Validates: Requirements 2.7
    [Property(MaxTest = 100)]
    [Trait("Property", "1")]
    public Property NormalisationIsCaseAndWhitespaceInsensitive() =>
        Prop.ForAll(Arb.From(PerturbationGen()), p =>
        {
            string variant1 = p.Lead1 + p.Core.ToUpperInvariant() + p.Trail1;
            string variant2 = p.Lead2 + p.Core.ToLowerInvariant() + p.Trail2;

            string n1 = EmailAddress.Normalise(variant1);
            string n2 = EmailAddress.Normalise(variant2);

            return n1 == n2 && n1 == p.Core.ToLowerInvariant();
        });

    /// <summary>A core address body plus surrounding whitespace for two case/whitespace variants.</summary>
    private sealed record Perturbation(string Core, string Lead1, string Trail1, string Lead2, string Trail2);

    /// <summary>Generates an arbitrary raw input string (possibly empty) from the representative set.</summary>
    private static Gen<string> RawGen() =>
        from chars in Gen.ListOf(Gen.Elements(RawChars))
        select new string(chars.ToArray());

    /// <summary>Generates a non-whitespace core body together with arbitrary surrounding whitespace for two variants.</summary>
    private static Gen<Perturbation> PerturbationGen() =>
        from core in CoreGen()
        from lead1 in WhitespaceGen()
        from trail1 in WhitespaceGen()
        from lead2 in WhitespaceGen()
        from trail2 in WhitespaceGen()
        select new Perturbation(core, lead1, trail1, lead2, trail2);

    /// <summary>Generates a possibly-empty string of non-whitespace ASCII characters.</summary>
    private static Gen<string> CoreGen() =>
        from chars in Gen.ListOf(Gen.Elements(CoreChars))
        select new string(chars.ToArray());

    /// <summary>Generates a possibly-empty run of whitespace characters.</summary>
    private static Gen<string> WhitespaceGen() =>
        from chars in Gen.ListOf(Gen.Elements(' ', '\t'))
        select new string(chars.ToArray());
}
