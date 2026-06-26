using FsCheck;
using FsCheck.Xunit;
using PitchMate.Application.Auth.Abstractions;
using PitchMate.Infrastructure.Auth;

namespace PitchMate.Infrastructure.Tests.Auth;

/// <summary>
/// Property-based test for <see cref="IdentityPasswordHasher"/> (auth-and-identity design
/// Property 4: Password hashing round-trip with per-credential salt). For any non-empty plaintext
/// password the hasher must satisfy three behaviours derived from the acceptance criteria:
/// <list type="number">
/// <item>Hashing then verifying against the original plaintext succeeds — either
/// <see cref="PasswordVerification.Success"/> or <see cref="PasswordVerification.SuccessRehashNeeded"/>
/// (Requirements 2.2, 3.2).</item>
/// <item>Verifying the hash against a different plaintext fails (Requirement 3.3).</item>
/// <item>Hashing the same plaintext twice yields two distinct hash strings — proving a unique
/// random per-credential salt — yet both verify successfully against the original plaintext
/// (Requirement 3.1).</item>
/// </list>
/// The generator produces a pair of distinct non-empty plaintexts so the success, failure, and
/// salt-uniqueness behaviours can all be exercised in a single property running at least 100
/// iterations.
/// </summary>
[Trait("Feature", "auth-and-identity")]
public class PasswordHashingRoundTripPropertyTests
{
    // Feature: auth-and-identity, Property 4: Password hashing round-trip with per-credential salt.
    // Hash(plaintext) then Verify(hash, plaintext) succeeds; Verify(hash, otherPlaintext) fails;
    // hashing the same plaintext twice yields distinct hashes that both verify.
    // **Validates: Requirements 2.2, 3.1, 3.2, 3.3**
    [Property(MaxTest = 100)]
    [Trait("Property", "4")]
    public Property HashingRoundTripSucceedsWithPerCredentialSalt()
    {
        var hasher = new IdentityPasswordHasher();

        return Prop.ForAll(Arb.From(DistinctPlaintextPairGen()), pair =>
        {
            var (plaintext, otherPlaintext) = pair;

            var firstHash = hasher.Hash(plaintext);
            var secondHash = hasher.Hash(plaintext);

            // (1) Round-trip against the original plaintext succeeds for both independently salted hashes.
            bool firstHashVerifies = Succeeded(hasher.Verify(firstHash, plaintext));
            bool secondHashVerifies = Succeeded(hasher.Verify(secondHash, plaintext));

            // (2) Verifying against a different plaintext fails.
            bool differentPlaintextFails =
                hasher.Verify(firstHash, otherPlaintext) == PasswordVerification.Failure;

            // (3) Per-credential salt: hashing the same plaintext twice yields distinct hash strings.
            bool saltMakesHashesDistinct = !string.Equals(firstHash, secondHash, StringComparison.Ordinal);

            return (firstHashVerifies && secondHashVerifies && differentPlaintextFails && saltMakesHashesDistinct)
                .Classify(firstHash.Length > 0, "produced non-empty hash");
        });
    }

    /// <summary>A verification result counts as a successful round-trip when it is success or rehash-needed.</summary>
    private static bool Succeeded(PasswordVerification result) =>
        result is PasswordVerification.Success or PasswordVerification.SuccessRehashNeeded;

    /// <summary>
    /// Generates a pair of <em>distinct</em> non-empty plaintext passwords. The second value is
    /// derived to differ from the first by construction (appending a sentinel character when the two
    /// independent draws happen to collide), so no value is ever discarded and the "different
    /// plaintext" arm of the property is always meaningful.
    /// </summary>
    private static Gen<(string Plaintext, string OtherPlaintext)> DistinctPlaintextPairGen() =>
        from plaintext in NonEmptyPlaintextGen()
        from candidate in NonEmptyPlaintextGen()
        let otherPlaintext = string.Equals(candidate, plaintext, StringComparison.Ordinal)
            ? candidate + "\u00a7" // guarantee distinctness when the independent draws collide
            : candidate
        select (plaintext, otherPlaintext);

    /// <summary>
    /// Generates a non-empty plaintext password from printable characters (ASCII plus a sprinkling of
    /// non-ASCII code points), covering a broad input space. The hasher enforces no length policy, so
    /// any non-empty string is a valid round-trip input.
    /// </summary>
    private static Gen<string> NonEmptyPlaintextGen() =>
        Gen.NonEmptyListOf(PlaintextCharGen()).Select(chars => new string([.. chars]));

    /// <summary>Generates a single printable character spanning ASCII and a small non-ASCII range.</summary>
    private static Gen<char> PlaintextCharGen() =>
        Gen.OneOf(
            Gen.Choose(32, 126).Select(code => (char)code),   // printable ASCII (space..~)
            Gen.Choose(0x00A1, 0x017F).Select(code => (char)code)); // Latin-1 supplement / Latin Extended-A
}
