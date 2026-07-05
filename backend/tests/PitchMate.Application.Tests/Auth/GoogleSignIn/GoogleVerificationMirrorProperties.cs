using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Application.Auth;
using PitchMate.Application.Auth.Abstractions;
using PitchMate.Application.Auth.UseCases;
using PitchMate.Domain.Auth;

namespace PitchMate.Application.Tests.Auth.GoogleSignIn;

/// <summary>
/// Property-based test for <see cref="SignInWithGoogleHandler"/> covering:
/// <list type="bullet">
///   <item><b>Property 15</b> — A new user created from a validated Google assertion bearing an
///   email claim is recorded as email-verified if and only if the assertion reports the email as
///   verified (Requirements 7.8, 7.9).</item>
/// </list>
/// Each case drives the real handler against the in-memory Google sign-in fakes (no database), per
/// the Application-layer testing strategy. A fresh subject (matching no existing Google identity)
/// guarantees a new <see cref="User"/> is created, and the <c>email_verified</c> flag is generated
/// both ways so the mirror is exercised in both directions.
/// </summary>
[Trait("Feature", "auth-and-identity")]
public class GoogleVerificationMirrorProperties
{
    // Feature: auth-and-identity, Property 15: Created user's verification state mirrors the Google
    // email_verified claim. For a fresh subject (a new user is created) whose assertion carries an
    // email claim, the created User.EmailVerified equals the assertion's email_verified flag — a
    // true claim yields a verified user; a false claim yields an unverified user.
    // Validates: Requirements 7.8, 7.9
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(GoogleVerificationMirrorGenerators) })]
    [Trait("Property", "15")]
    public Property Property15_CreatedUser_VerificationState_MirrorsEmailVerifiedClaim(
        GoogleVerifiedAssertionInput input)
    {
        var store = new GoogleSignInStore();
        var handler = new SignInWithGoogleHandler(
            GoogleSignInVerifierFake.Returning(
                new ExternalIdentity(AuthProvider.Google, input.Subject, input.Email, input.EmailVerified)),
            new GoogleSignInUserRepositoryFake(store),
            new GoogleSignInAuthIdentityRepositoryFake(store),
            new GoogleSignInTokenServiceFake(),
            new GoogleSignInRefreshTokenStoreFake(store),
            new GoogleSignInUnitOfWorkFake(store));

        Result<AuthSession> result = handler
            .HandleAsync(new SignInWithGoogleCommand("assertion"), CancellationToken.None)
            .GetAwaiter()
            .GetResult();

        // The fresh subject means exactly one new user is created and the sign-in succeeds.
        bool succeeded = result.IsSuccess;
        bool exactlyOneUser = store.Users.Count == 1;

        // The created user's verification state mirrors the assertion's email_verified flag:
        // true claim => verified user; false claim => unverified user.
        bool verificationMirrorsClaim =
            exactlyOneUser && store.Users[0].EmailVerified == input.EmailVerified;

        return (succeeded && exactlyOneUser && verificationMirrorsClaim).ToProperty();
    }
}

/// <summary>
/// A validated Google assertion that <em>always carries an email claim</em> (Property 15 is scoped to
/// assertions "containing an email claim"), together with the present (non-empty, non-whitespace)
/// subject and the <c>email_verified</c> flag whose mirroring is under test.
/// </summary>
public sealed record GoogleVerifiedAssertionInput(string Subject, string Email, bool EmailVerified);

/// <summary>
/// FsCheck arbitraries for the Property 15 verification-mirror test. Smart generators constrain inputs
/// to the valid space the verifier would have already accepted: a present subject drawn from a
/// realistic identifier alphabet, an always-present syntactically valid email (the property requires an
/// email claim), and the <c>email_verified</c> flag generated both ways. Referenced via
/// <c>[Property(Arbitrary = new[] { typeof(GoogleVerificationMirrorGenerators) })]</c>.
/// </summary>
public static class GoogleVerificationMirrorGenerators
{
    private static readonly char[] SubjectAlphabet =
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_".ToCharArray();

    private static readonly char[] EmailAlphabet =
        "abcdefghijklmnopqrstuvwxyz0123456789".ToCharArray();

    /// <summary>Arbitrary for a validated, email-bearing Google assertion payload.</summary>
    public static Arbitrary<GoogleVerifiedAssertionInput> GoogleVerifiedAssertionInput() =>
        Arb.From(GoogleVerifiedAssertionInputGen());

    private static Gen<GoogleVerifiedAssertionInput> GoogleVerifiedAssertionInputGen() =>
        from subject in Subject()
        from email in CanonicalEmail()
        from emailVerified in Gen.Elements(true, false)
        select new GoogleVerifiedAssertionInput(subject, email, emailVerified);

    /// <summary>A present subject: 1–40 characters from a realistic provider-id alphabet.</summary>
    private static Gen<string> Subject() =>
        from length in Gen.Choose(1, 40)
        from chars in ListOfLength(length, Gen.Elements(SubjectAlphabet))
        select new string(chars.ToArray());

    private static Gen<string> CanonicalEmail() =>
        from local in Word(1, 20)
        from label in Word(1, 20)
        from tld in Word(2, 6)
        select $"{local}@{label}.{tld}";

    private static Gen<string> Word(int minLength, int maxLength) =>
        from length in Gen.Choose(minLength, maxLength)
        from chars in ListOfLength(length, Gen.Elements(EmailAlphabet))
        select new string(chars.ToArray());

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
