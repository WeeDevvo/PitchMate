using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Application.Auth;
using PitchMate.Application.Auth.UseCases;
using PitchMate.Domain.Auth;

namespace PitchMate.Application.Tests.Auth.PasswordSignIn;

/// <summary>
/// Property 21: Malformed sign-in input is a distinct validation failure that skips hashing.
/// <para>
/// For any sign-in request whose email is missing/malformed or whose password is empty, the
/// <see cref="SignInWithPasswordHandler"/> returns a validation failure
/// (<see cref="AuthErrorCode.ValidationFailed"/>) that is distinct from the generic
/// authentication-failure result, and performs <em>no</em> password-hash verification — the
/// <see cref="MalformedSignInPasswordHasherSpy"/> records zero <c>Verify</c> calls. Because the
/// handler short-circuits before resolving an identity, nothing is issued or persisted either.
/// Exercised over in-memory fakes as a pure Application unit test, at least 100 iterations.
/// </para>
/// </summary>
[Trait("Feature", "auth-and-identity")]
public class MalformedSignInPropertyTests
{
    private const string SeededEmail = "owner@example.com";
    private const string SeededPassword = "correct-horse-battery-staple";

    // Feature: auth-and-identity, Property 21: Malformed sign-in input is a distinct validation
    // failure that skips hashing. Validates: Requirements 6.3
    [Property(MaxTest = 100)]
    [Trait("Property", "21")]
    public Property MalformedSignInInput_IsDistinctValidationFailureThatSkipsHashing() =>
        Prop.ForAll(Arb.From(MalformedCommandGen()), command =>
        {
            // Arrange: a fully wired handler over in-memory fakes, with one real Password identity
            // seeded so that — were the handler not to short-circuit — a credential would be found
            // and verification attempted. Lockout and verified-email gates stay off (the default).
            var clock = new MalformedSignInFakeClock();
            var hasher = new MalformedSignInPasswordHasherSpy();
            var identities = new MalformedSignInAuthIdentityRepositoryFake();
            var users = new MalformedSignInUserRepositoryFake();
            var tokenService = new MalformedSignInTokenServiceFake(clock);
            var refreshTokens = new MalformedSignInRefreshTokenStoreFake();
            var attemptTracker = new MalformedSignInAttemptTrackerFake();
            var unitOfWork = new MalformedSignInUnitOfWorkFake();

            User user = User.Create("Owner", SeededEmail, emailVerified: true);
            users.Seed(user);
            var credential = PasswordCredential.Create(hasher.Hash(SeededPassword));
            identities.Seed(AuthIdentity.ForPassword(user.Id, SeededEmail, credential));

            // Seeding the credential calls Hash once; reset the spy so the assertions observe only
            // what the handler itself does.
            hasher = new MalformedSignInPasswordHasherSpy();

            var handler = new SignInWithPasswordHandler(
                identities,
                users,
                hasher,
                tokenService,
                refreshTokens,
                attemptTracker,
                unitOfWork,
                clock,
                new SignInProtectionOptions());

            // Act
            Result<AuthSession> result = handler
                .HandleAsync(command, CancellationToken.None)
                .GetAwaiter()
                .GetResult();

            // Assert: a distinct validation failure …
            bool rejectedAsValidation =
                !result.IsSuccess && result.Error?.Code == AuthErrorCode.ValidationFailed;
            bool distinctFromAuthFailure = result.Error?.Code != AuthErrorCode.AuthenticationFailed;

            // … that skipped all password hashing/verification …
            bool noVerification = hasher.VerifyCallCount == 0;
            bool noHashing = hasher.HashCallCount == 0;

            // … and reached neither identity resolution nor any token issuance/persistence.
            bool nothingResolved = identities.FindCallCount == 0;
            bool nothingIssued = tokenService.IssueCallCount == 0 && tokenService.GenerateCallCount == 0;
            bool nothingPersisted = refreshTokens.All.Count == 0 && unitOfWork.SaveCount == 0;

            return (rejectedAsValidation
                    && distinctFromAuthFailure
                    && noVerification
                    && noHashing
                    && nothingResolved
                    && nothingIssued
                    && nothingPersisted)
                .Label($"command=({Describe(command.Email)}, {Describe(command.Password)}), " +
                       $"code={result.Error?.Code}, verify={hasher.VerifyCallCount}, hash={hasher.HashCallCount}, " +
                       $"finds={identities.FindCallCount}, saves={unitOfWork.SaveCount}");
        });

    private static string Describe(string? value) =>
        value is null ? "<null>" : $"\"{value}\"";

    /// <summary>
    /// Generates a <see cref="SignInWithPasswordCommand"/> that is malformed in at least one of the
    /// two ways Requirement 6.3 names: a missing/malformed email, or an empty password.
    /// </summary>
    private static Gen<SignInWithPasswordCommand> MalformedCommandGen() =>
        Gen.OneOf(
            // Malformed/missing email paired with an arbitrary password (valid or not).
            from email in MalformedEmail()
            from password in AnyPassword()
            select new SignInWithPasswordCommand(email, password),
            // Valid email paired with an empty/missing password.
            from email in ValidEmail()
            from password in EmptyPassword()
            select new SignInWithPasswordCommand(email, password));

    /// <summary>An email value that <see cref="EmailAddress.Create"/> rejects.</summary>
    private static Gen<string?> MalformedEmail()
    {
        Gen<string?> fixedShapes = Gen.Elements<string?>(
            null,
            "",
            "   ",
            "plainaddress",
            "@no-local.com",
            "no-domain@",
            "no-at-sign.com",
            "two@@example.com",
            "user@nodot",
            "spaces in@example.com",
            "user@ex ample.com",
            "user@.com",
            "user@com.");

        Gen<string?> noAtSign =
            from chars in Gen.ListOf(Gen.Elements("abcdefghijklmnopqrstuvwxyz0123456789".ToCharArray()))
            let s = new string(chars.ToArray())
            select (string?)(s.Length == 0 ? "x" : s);

        return Gen.OneOf(fixedShapes, noAtSign);
    }

    /// <summary>A raw email that <see cref="EmailAddress.Create"/> accepts (lower-case, so raw == normalised).</summary>
    private static Gen<string> ValidEmail() =>
        from local in Gen.ListOf(Gen.Elements("abcdefghijklmnopqrstuvwxyz0123456789".ToCharArray()))
        from label in Gen.ListOf(Gen.Elements("abcdefghijklmnopqrstuvwxyz0123456789".ToCharArray()))
        let l = "a" + new string(local.ToArray())
        let d = "a" + new string(label.ToArray())
        select l[..Math.Min(l.Length, 24)] + "@" + d[..Math.Min(d.Length, 20)] + ".com";

    /// <summary>An empty or missing password.</summary>
    private static Gen<string?> EmptyPassword() => Gen.Elements<string?>(null, "");

    /// <summary>Any password — empty, missing, or a policy-compliant value.</summary>
    private static Gen<string?> AnyPassword() =>
        Gen.OneOf(
            EmptyPassword(),
            from len in Gen.Choose(12, 40)
            from chars in Gen.ListOf(Gen.Elements("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".ToCharArray()))
            let s = new string(chars.ToArray()) + new string('a', 40)
            select (string?)s[..len]);
}
