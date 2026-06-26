using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Application.Auth;
using PitchMate.Application.Auth.UseCases;
using PitchMate.Domain.Auth;

namespace PitchMate.Application.Tests.Auth.PasswordSignIn;

/// <summary>
/// Property-based test for <see cref="SignInWithPasswordHandler"/> covering the generic
/// sign-in failure correctness property:
/// <list type="bullet">
///   <item><b>Property 20</b> — a failed sign-in yields one indistinguishable generic result
///   (Requirement 6.2).</item>
/// </list>
/// The test drives the real handler against the in-memory password sign-in fakes (no database),
/// per the Application-layer testing strategy, with the optional lockout and verified-email gates
/// disabled (the MVP default).
/// </summary>
[Trait("Feature", "auth-and-identity")]
public class GenericSignInFailurePropertyTests
{
    // Feature: auth-and-identity, Property 20: Failed sign-in yields one indistinguishable
    // generic result.
    // Validates: Requirements 6.2
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(GenericSignInFailureGenerators) })]
    public Property Property20_FailedSignInYieldsOneIndistinguishableGenericResult(
        GenericSignInFailureInput input)
    {
        // Path A: an email that has no Password identity at all (unregistered).
        FailureObservation noIdentity = SignInAgainstFreshState(input, registerAccount: false);

        // Path B: a registered email paired with the wrong password.
        FailureObservation wrongPassword = SignInAgainstFreshState(input, registerAccount: true);

        // Each path must be a generic authentication failure that establishes no session,
        // issues no tokens, and persists no refresh-token hash (Requirement 6.2).
        bool noIdentityIsCleanGenericFailure = IsCleanGenericFailure(noIdentity);
        bool wrongPasswordIsCleanGenericFailure = IsCleanGenericFailure(wrongPassword);

        // Both paths still performed the fixed-time password verification (so a non-existent
        // account is not cheaper than a wrong password), reinforcing indistinguishability.
        bool bothVerified = noIdentity.PerformedVerification && wrongPassword.PerformedVerification;

        // The two failure paths are indistinguishable in their result: identical error code and
        // identical message, and neither carries a session value.
        bool indistinguishable =
            noIdentity.ErrorCode == wrongPassword.ErrorCode
            && noIdentity.ErrorMessage == wrongPassword.ErrorMessage
            && !noIdentity.HasValue
            && !wrongPassword.HasValue;

        return (noIdentityIsCleanGenericFailure
            && wrongPasswordIsCleanGenericFailure
            && bothVerified
            && indistinguishable).ToProperty();
    }

    /// <summary>
    /// Runs one sign-in attempt against a freshly built set of fakes. When
    /// <paramref name="registerAccount"/> is set, the registered email is seeded as a Password
    /// identity whose stored hash matches <see cref="GenericSignInFailureInput.CorrectPassword"/>,
    /// and the attempt presents the (different) wrong password against that registered email.
    /// Otherwise the attempt presents the unregistered email, which has no Password identity.
    /// </summary>
    private static FailureObservation SignInAgainstFreshState(
        GenericSignInFailureInput input, bool registerAccount)
    {
        var clock = new PasswordSignInFakeClock();
        var hasher = new PasswordSignInPasswordHasherFake();
        var tokenService = new PasswordSignInTokenServiceFake(clock);
        var identities = new PasswordSignInAuthIdentityRepositoryFake();
        var users = new PasswordSignInUserRepositoryFake();
        var refreshTokens = new PasswordSignInRefreshTokenStoreFake(clock);
        var attemptTracker = new PasswordSignInAttemptTrackerFake();
        var unitOfWork = new PasswordSignInUnitOfWorkFake();
        var protection = new SignInProtectionOptions(); // lockout + verified-email gate off

        string attemptEmail;
        string attemptPassword;

        if (registerAccount)
        {
            // Seed a registered Password identity for the registered email whose stored hash
            // matches the correct password, then attempt with the wrong password.
            string normalised = EmailAddress.Normalise(input.RegisteredRawEmail);
            var user = User.Create("Pat Player", normalised);
            users.Seed(user);

            var credential = PasswordCredential.Create(hasher.Hash(input.CorrectPassword));
            identities.Seed(AuthIdentity.ForPassword(user.Id, normalised, credential));

            attemptEmail = input.RegisteredRawEmail;
            attemptPassword = input.WrongPassword;
        }
        else
        {
            // No identity seeded: the unregistered email resolves to nothing.
            attemptEmail = input.UnregisteredRawEmail;
            attemptPassword = input.UnregisteredAttemptPassword;
        }

        var handler = new SignInWithPasswordHandler(
            identities, users, hasher, tokenService, refreshTokens, attemptTracker,
            unitOfWork, clock, protection);

        Result<AuthSession> result = handler
            .HandleAsync(new SignInWithPasswordCommand(attemptEmail, attemptPassword), CancellationToken.None)
            .GetAwaiter()
            .GetResult();

        return new FailureObservation(
            IsSuccess: result.IsSuccess,
            ErrorCode: result.Error?.Code,
            ErrorMessage: result.Error?.Message,
            HasValue: result.IsSuccess && result.Value is not null,
            AccessTokensIssued: tokenService.IssuedFor.Count,
            RefreshTokensGenerated: tokenService.RefreshTokensGenerated,
            RefreshTokensPersisted: refreshTokens.All.Count,
            SaveCount: unitOfWork.SaveCount,
            PerformedVerification: hasher.VerifiedStoredHashes.Count > 0);
    }

    /// <summary>
    /// A clean generic failure: the result failed with the generic
    /// <see cref="AuthErrorCode.AuthenticationFailed"/> code, carried no session value, issued no
    /// access or refresh token, persisted no refresh-token hash, and committed nothing.
    /// </summary>
    private static bool IsCleanGenericFailure(FailureObservation o) =>
        !o.IsSuccess
        && o.ErrorCode == AuthErrorCode.AuthenticationFailed
        && !o.HasValue
        && o.AccessTokensIssued == 0
        && o.RefreshTokensGenerated == 0
        && o.RefreshTokensPersisted == 0
        && o.SaveCount == 0;

    /// <summary>The externally observable outcome of a single sign-in attempt.</summary>
    private sealed record FailureObservation(
        bool IsSuccess,
        AuthErrorCode? ErrorCode,
        string? ErrorMessage,
        bool HasValue,
        int AccessTokensIssued,
        int RefreshTokensGenerated,
        int RefreshTokensPersisted,
        int SaveCount,
        bool PerformedVerification);
}

/// <summary>
/// A single generic-failure scenario: a registered email (seeded with a correct password) and a
/// distinct unregistered email, plus three non-empty passwords. The correct and wrong passwords
/// differ so the registered-email attempt is a genuine wrong-password failure; all emails are
/// syntactically valid so neither attempt is short-circuited as an input-validation failure.
/// </summary>
public sealed record GenericSignInFailureInput(
    string RegisteredRawEmail,
    string UnregisteredRawEmail,
    string CorrectPassword,
    string WrongPassword,
    string UnregisteredAttemptPassword);

/// <summary>
/// FsCheck arbitraries for the generic sign-in failure property. Smart generators constrain
/// inputs to the space that reaches the authentication-failure path: syntactically valid,
/// distinct registered/unregistered emails (guaranteed distinct by disjoint local-part prefixes)
/// and non-empty passwords where the wrong password differs from the correct one. Referenced via
/// <c>[Property(Arbitrary = new[] { typeof(GenericSignInFailureGenerators) })]</c>.
/// </summary>
public static class GenericSignInFailureGenerators
{
    private static readonly char[] EmailAlphabet =
        "abcdefghijklmnopqrstuvwxyz0123456789".ToCharArray();

    private static readonly char[] PasswordAlphabet =
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()-_=+".ToCharArray();

    /// <summary>Arbitrary for a single generic sign-in failure scenario.</summary>
    public static Arbitrary<GenericSignInFailureInput> GenericSignInFailureInput() =>
        Arb.From(GenericSignInFailureInputGen());

    private static Gen<GenericSignInFailureInput> GenericSignInFailureInputGen() =>
        from registered in PrefixedEmail("reg")
        from unregistered in PrefixedEmail("unreg")
        from correct in NonEmptyPassword()
        from wrong in NonEmptyPassword().Where(p => p != correct)
        from attempt in NonEmptyPassword()
        select new GenericSignInFailureInput(registered, unregistered, correct, wrong, attempt);

    /// <summary>
    /// A syntactically valid email of the form <c>{prefix}-{word}@{label}.{tld}</c>. The disjoint
    /// <c>reg-</c> / <c>unreg-</c> local-part prefixes guarantee the registered and unregistered
    /// emails never normalise to the same key.
    /// </summary>
    private static Gen<string> PrefixedEmail(string prefix) =>
        from local in Word(1, 16)
        from label in Word(1, 16)
        from tld in Word(2, 6)
        select $"{prefix}-{local}@{label}.{tld}";

    /// <summary>A non-empty password of 1–64 characters from a broad printable alphabet.</summary>
    private static Gen<string> NonEmptyPassword() =>
        from length in Gen.Choose(1, 64)
        from chars in ListOfLength(length, Gen.Elements(PasswordAlphabet))
        select new string(chars.ToArray());

    /// <summary>A non-empty token of <paramref name="minLength"/>–<paramref name="maxLength"/> lowercase/digit characters.</summary>
    private static Gen<string> Word(int minLength, int maxLength) =>
        from length in Gen.Choose(minLength, maxLength)
        from chars in ListOfLength(length, Gen.Elements(EmailAlphabet))
        select new string(chars.ToArray());

    /// <summary>Builds a generator for a list of exactly <paramref name="length"/> items.</summary>
    private static Gen<List<T>> ListOfLength<T>(int length, Gen<T> element)
    {
        if (length <= 0)
        {
            return Gen.Constant(new List<T>());
        }

        return from head in element
               from tail in ListOfLength(length - 1, element)
               select Prepend(head, tail);
    }

    private static List<T> Prepend<T>(T head, List<T> tail)
    {
        var result = new List<T>(tail.Count + 1) { head };
        result.AddRange(tail);
        return result;
    }
}
