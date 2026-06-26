using FsCheck;
using FsCheck.Xunit;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;
using PitchMate.Application.Auth.Abstractions;
using PitchMate.Domain.Auth;
using PitchMate.Infrastructure.Auth;

namespace PitchMate.Infrastructure.Tests.Auth;

/// <summary>
/// Property-based test for re-hash on verify (auth-and-identity design Property 5).
/// </summary>
/// <remarks>
/// <para>
/// Requirement 3.5: when a stored <c>Password_Hash</c> was produced with hashing parameters weaker
/// than the currently configured parameters, a successful verify reports
/// <see cref="PasswordVerification.SuccessRehashNeeded"/> so the caller re-hashes — without changing
/// the success verdict itself. The upgrade signal must never flip a wrong password to a success.
/// </para>
/// <para>
/// A deterministically "weak" stored hash is produced by a separate
/// <see cref="PasswordHasher{TUser}"/> configured with the older
/// <see cref="PasswordHasherCompatibilityMode.IdentityV2"/> compatibility mode. The
/// <see cref="IdentityPasswordHasher"/> under test wraps a default
/// <see cref="PasswordHasher{TUser}"/> (current <c>IdentityV3</c> parameters), so verifying a
/// V2-format hash that matches reliably yields <see cref="PasswordVerification.SuccessRehashNeeded"/>.
/// Each property runs a minimum of 100 iterations.
/// </para>
/// </remarks>
[Trait("Feature", "auth-and-identity")]
public class IdentityPasswordHasherRehashProperties
{
    // The generic User argument is unused by the PBKDF2 implementation; a single throwaway instance
    // satisfies the non-null parameter when producing the deliberately weak stored hash.
    private static readonly User HashUser = User.Create("rehash-test", "rehash@users.invalid");

    // A hasher pinned to the legacy IdentityV2 compatibility mode. Hashes it produces are weaker than
    // the current default (IdentityV3) the IdentityPasswordHasher uses, so a successful verify of one
    // of these hashes must be flagged for re-hashing.
    private static readonly PasswordHasher<User> WeakHasher = new(
        Options.Create(new PasswordHasherOptions
        {
            CompatibilityMode = PasswordHasherCompatibilityMode.IdentityV2,
        }));

    // Feature: auth-and-identity, Property 5: Re-hash on verify upgrades weak parameters without
    // changing the verdict. A correct password against a weak stored hash verifies as
    // SuccessRehashNeeded; a wrong password against the same hash verifies as Failure.
    // Validates: Requirements 3.5
    [Property(MaxTest = 100)]
    [Trait("Property", "5")]
    public Property WeakStoredHashUpgradesOnVerifyWithoutChangingTheVerdict() =>
        Prop.ForAll(Arb.From(CorrectAndWrongGen()), pair =>
        {
            var (correct, wrong) = pair;

            var weakStoredHash = WeakHasher.HashPassword(HashUser, correct);
            var hasher = new IdentityPasswordHasher();

            // The correct password still verifies (a success, never a failure) AND is flagged for the
            // parameter upgrade.
            var correctVerdict = hasher.Verify(weakStoredHash, correct);

            // The upgrade signal never promotes a wrong password to any kind of success.
            var wrongVerdict = hasher.Verify(weakStoredHash, wrong);

            return (correctVerdict == PasswordVerification.SuccessRehashNeeded)
                .Label($"correct password expected SuccessRehashNeeded but was {correctVerdict}")
                .And((wrongVerdict == PasswordVerification.Failure)
                    .Label($"wrong password expected Failure but was {wrongVerdict}"));
        });

    /// <summary>
    /// Generates a (correct, wrong) password pair where the two values are guaranteed to differ, so the
    /// "wrong password" case is genuinely a mismatch.
    /// </summary>
    private static Gen<(string Correct, string Wrong)> CorrectAndWrongGen() =>
        from correct in PasswordGen()
        from candidate in PasswordGen()
        let wrong = candidate == correct ? candidate + "\u00a7" : candidate
        select (correct, wrong);

    /// <summary>
    /// Generates an arbitrary-length password from printable ASCII characters (including the empty
    /// string), which the framework hasher accepts and hashes deterministically per call.
    /// </summary>
    private static Gen<string> PasswordGen() =>
        Gen.ArrayOf(Gen.Choose(33, 126).Select(code => (char)code))
            .Select(chars => new string(chars));
}
