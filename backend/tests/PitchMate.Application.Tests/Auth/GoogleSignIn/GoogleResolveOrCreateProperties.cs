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
///   <item><b>Property 13</b> — Google sign-in resolves or creates solely by subject
///   (Requirement 7.5).</item>
/// </list>
/// For a validated Google assertion the resolution/creation key is <em>solely</em> the subject
/// (<c>(Google, sub)</c>): when no such identity exists the handler creates exactly one new
/// <see cref="User"/> and one new <see cref="AuthProvider.Google"/> <see cref="AuthIdentity"/>
/// keyed on the subject and establishes a session for the new user; when one already exists the
/// session is for that identity's owning user and no new records are created — regardless of the
/// email the assertion happens to carry. Each test drives the real handler against the in-memory
/// Google sign-in fakes (no database), per the Application-layer testing strategy.
/// </summary>
[Trait("Feature", "auth-and-identity")]
public class GoogleResolveOrCreateProperties
{
    // Feature: auth-and-identity, Property 13: Google sign-in resolves or creates solely by
    // subject. A validated assertion whose subject matches no existing Google identity creates
    // exactly one new User and one new Google AuthIdentity keyed on that subject, and establishes
    // a session for the new user. Validates: Requirement 7.5
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(GoogleResolveOrCreateGenerators) })]
    [Trait("Property", "13")]
    public Property Property13_NewSubject_CreatesExactlyOneUserAndIdentity_AndEstablishesSession(
        GoogleAssertionInput input)
    {
        var store = new GoogleSignInStore();
        var tokenService = new GoogleSignInTokenServiceFake();
        var handler = new SignInWithGoogleHandler(
            GoogleSignInVerifierFake.Returning(
                new ExternalIdentity(AuthProvider.Google, input.Subject, input.Email, input.EmailVerified)),
            new GoogleSignInUserRepositoryFake(store),
            new GoogleSignInAuthIdentityRepositoryFake(store),
            tokenService,
            new GoogleSignInRefreshTokenStoreFake(store),
            new GoogleSignInUnitOfWorkFake(store));

        Result<AuthSession> result = handler
            .HandleAsync(new SignInWithGoogleCommand("assertion"), CancellationToken.None)
            .GetAwaiter()
            .GetResult();

        // Exactly one new user and one new Google identity, keyed on the subject and owned by
        // the created user.
        bool succeeded = result.IsSuccess;
        bool exactlyOneUser = store.Users.Count == 1;
        bool exactlyOneIdentity = store.Identities.Count == 1;

        bool identityKeyedOnSubject =
            exactlyOneIdentity
            && store.Identities[0].Provider == AuthProvider.Google
            && store.Identities[0].ProviderUserId == input.Subject
            && store.Identities[0].Credential is null;

        bool ownership =
            exactlyOneUser
            && exactlyOneIdentity
            && store.Identities[0].UserId == store.Users[0].Id;

        // The session is for the newly created user and an access token was issued for them.
        bool sessionForNewUser =
            succeeded && exactlyOneUser && result.Value!.UserId == store.Users[0].Id;
        bool tokenIssuedForNewUser =
            succeeded && exactlyOneUser && tokenService.IssuedFor is [var issued] && issued == store.Users[0].Id;

        return (succeeded
            && exactlyOneUser
            && exactlyOneIdentity
            && identityKeyedOnSubject
            && ownership
            && sessionForNewUser
            && tokenIssuedForNewUser).ToProperty();
    }

    // Feature: auth-and-identity, Property 13: Google sign-in resolves or creates solely by
    // subject. When the subject matches an existing Google identity, the session is for that
    // identity's owning user and no new records are created — even if the assertion carries a
    // different email, since resolution keys solely on the subject. Validates: Requirement 7.5
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(GoogleResolveOrCreateGenerators) })]
    [Trait("Property", "13")]
    public Property Property13_ExistingSubject_ResolvesOwner_AndCreatesNothing(
        GoogleAssertionInput input)
    {
        var store = new GoogleSignInStore();
        var tokenService = new GoogleSignInTokenServiceFake();

        // Seed a pre-existing user owning a Google identity keyed on the subject. Its email is
        // deliberately unrelated to the email the assertion will carry, proving resolution keys
        // solely on the subject and never on email.
        var owner = User.Create("Existing Owner", "owner@example.com", emailVerified: true);
        AuthIdentity existing = AuthIdentity.ForExternal(owner.Id, AuthProvider.Google, input.Subject);
        store.SeedUser(owner);
        store.SeedIdentity(existing);

        var handler = new SignInWithGoogleHandler(
            GoogleSignInVerifierFake.Returning(
                new ExternalIdentity(AuthProvider.Google, input.Subject, input.Email, input.EmailVerified)),
            new GoogleSignInUserRepositoryFake(store),
            new GoogleSignInAuthIdentityRepositoryFake(store),
            tokenService,
            new GoogleSignInRefreshTokenStoreFake(store),
            new GoogleSignInUnitOfWorkFake(store));

        Result<AuthSession> result = handler
            .HandleAsync(new SignInWithGoogleCommand("assertion"), CancellationToken.None)
            .GetAwaiter()
            .GetResult();

        // The session belongs to the existing owner.
        bool succeeded = result.IsSuccess;
        bool sessionForOwner = succeeded && result.Value!.UserId == owner.Id;

        // No new user or identity was created — the original pair remains the only ones.
        bool noNewUser = store.Users.Count == 1 && store.Users[0].Id == owner.Id;
        bool noNewIdentity =
            store.Identities.Count == 1
            && store.Identities[0].ProviderUserId == input.Subject
            && store.Identities[0].UserId == owner.Id;

        // A session was still established for the owner: an access token issued for them and a
        // single refresh-token family started.
        bool tokenIssuedForOwner = tokenService.IssuedFor is [var issued] && issued == owner.Id;
        bool oneRefreshFamilyForOwner =
            store.RefreshTokens.Count == 1 && store.RefreshTokens[0].UserId == owner.Id;

        return (succeeded
            && sessionForOwner
            && noNewUser
            && noNewIdentity
            && tokenIssuedForOwner
            && oneRefreshFamilyForOwner).ToProperty();
    }
}

/// <summary>
/// A validated Google assertion's payload: a non-empty, non-whitespace subject (the provider's
/// stable <c>sub</c>) together with an optional email claim and its verified flag. The email is
/// independent of the subject so the tests can prove resolution/creation keys solely on the subject.
/// </summary>
public sealed record GoogleAssertionInput(string Subject, string? Email, bool EmailVerified);

/// <summary>
/// FsCheck arbitraries for the Google resolve-or-create property. Smart generators constrain inputs
/// to the valid space the verifier would have already accepted: a present (non-empty, non-whitespace)
/// subject drawn from a realistic identifier alphabet, plus an optional syntactically valid email so
/// the created user satisfies its non-empty-email invariant without coupling to the subject. Referenced
/// via <c>[Property(Arbitrary = new[] { typeof(GoogleResolveOrCreateGenerators) })]</c>.
/// </summary>
public static class GoogleResolveOrCreateGenerators
{
    private static readonly char[] SubjectAlphabet =
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_".ToCharArray();

    private static readonly char[] EmailAlphabet =
        "abcdefghijklmnopqrstuvwxyz0123456789".ToCharArray();

    /// <summary>Arbitrary for a validated Google assertion payload.</summary>
    public static Arbitrary<GoogleAssertionInput> GoogleAssertionInput() =>
        Arb.From(GoogleAssertionInputGen());

    private static Gen<GoogleAssertionInput> GoogleAssertionInputGen() =>
        from subject in Subject()
        from email in MaybeEmail()
        from emailVerified in Gen.Elements(true, false)
        select new GoogleAssertionInput(subject, email, emailVerified);

    /// <summary>A present subject: 1–40 characters from a realistic provider-id alphabet.</summary>
    private static Gen<string> Subject() =>
        from length in Gen.Choose(1, 40)
        from chars in ListOfLength(length, Gen.Elements(SubjectAlphabet))
        select new string(chars.ToArray());

    /// <summary>An optional syntactically valid email (sometimes absent, modelling no email claim).</summary>
    private static Gen<string?> MaybeEmail() =>
        Gen.Frequency(
            (3, CanonicalEmail().Select(e => (string?)e)),
            (1, Gen.Constant((string?)null)));

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
