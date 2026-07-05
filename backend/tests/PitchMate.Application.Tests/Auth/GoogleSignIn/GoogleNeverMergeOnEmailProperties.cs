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
///   <item><b>Property 14</b> — Google sign-in never merges on email (Requirement 7.6).</item>
/// </list>
/// For any directory in which some pre-existing <see cref="User"/> already holds an
/// <c>Email_Address</c> <c>E</c> — through <em>any</em> provider (an existing Password identity, or a
/// Google identity bearing a <strong>different</strong> subject) — a validated Google assertion
/// carrying a <em>fresh</em> subject and that same email <c>E</c> creates a brand-new
/// <see cref="User"/> and a new <see cref="AuthProvider.Google"/> <see cref="AuthIdentity"/> keyed on
/// the fresh subject, and <strong>never</strong> attaches to, or merges with, the user that already
/// holds <c>E</c>. The resolution key is solely <c>(Google, sub)</c>; the asserted email is never a
/// matching key. Each test drives the real handler against the in-memory Google sign-in fakes (no
/// database), per the Application-layer testing strategy.
/// </summary>
[Trait("Feature", "auth-and-identity")]
public class GoogleNeverMergeOnEmailProperties
{
    // Feature: auth-and-identity, Property 14: Google sign-in never merges on email. A validated
    // Google assertion whose email claim already belongs to a DIFFERENT user (through a Password
    // identity or another Google identity with a different subject) must NOT merge with or attach to
    // that user: the handler creates a brand-new user and Google identity matched solely on the fresh
    // subject, and leaves the email-holder's identities unchanged. Validates: Requirement 7.6
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(GoogleNeverMergeGenerators) })]
    [Trait("Property", "14")]
    public Property Property14_FreshSubjectWithEmailHeldByAnotherUser_CreatesNewUser_AndNeverMerges(
        GoogleNeverMergeInput input)
    {
        var store = new GoogleSignInStore();
        var tokenService = new GoogleSignInTokenServiceFake();

        // Seed a pre-existing user that already holds the asserted email E, attached via the chosen
        // provider key. The key is deliberately NOT the fresh subject the assertion will carry.
        var holder = User.Create("Email Holder", input.Email, emailVerified: true);
        AuthIdentity holderIdentity = input.HolderUsesGoogle
            ? AuthIdentity.ForExternal(holder.Id, AuthProvider.Google, input.HolderGoogleSubject)
            : AuthIdentity.ForPassword(
                holder.Id,
                EmailAddress.Normalise(input.Email),
                PasswordCredential.Create("stored-hash"));
        store.SeedUser(holder);
        store.SeedIdentity(holderIdentity);

        // Capture the holder's identity state up-front so we can prove it is untouched afterwards.
        Guid holderId = holder.Id;
        string holderEmailBefore = holder.Email;
        AuthProvider holderProviderBefore = holderIdentity.Provider;
        string holderProviderUserIdBefore = holderIdentity.ProviderUserId;
        Guid holderIdentityOwnerBefore = holderIdentity.UserId;

        var handler = new SignInWithGoogleHandler(
            GoogleSignInVerifierFake.Returning(
                new ExternalIdentity(AuthProvider.Google, input.AssertionSubject, input.Email, input.EmailVerified)),
            new GoogleSignInUserRepositoryFake(store),
            new GoogleSignInAuthIdentityRepositoryFake(store),
            tokenService,
            new GoogleSignInRefreshTokenStoreFake(store),
            new GoogleSignInUnitOfWorkFake(store));

        Result<AuthSession> result = handler
            .HandleAsync(new SignInWithGoogleCommand("assertion"), CancellationToken.None)
            .GetAwaiter()
            .GetResult();

        // Sign-in succeeds by creating a brand-new account, never reusing the email-holder.
        bool succeeded = result.IsSuccess;
        bool brandNewUserCreated = store.Users.Count == 2;
        bool sessionNotForHolder = succeeded && result.Value!.UserId != holderId;

        // The new Google identity is keyed on the fresh subject and owned by the new user, not the
        // email-holder.
        AuthIdentity? freshGoogleIdentity = store.Identities
            .FirstOrDefault(i => i.Provider == AuthProvider.Google && i.ProviderUserId == input.AssertionSubject);
        bool freshIdentityCreated = freshGoogleIdentity is not null;
        bool freshIdentityOwnedByNewUser =
            succeeded
            && freshIdentityCreated
            && freshGoogleIdentity!.UserId == result.Value!.UserId
            && freshGoogleIdentity.UserId != holderId;

        // The email-holder's identity is completely unchanged: same single identity, same provider key,
        // still owned by the holder, and the holder still holds email E.
        AuthIdentity? holderAfter = store.Identities
            .FirstOrDefault(i => i.UserId == holderId);
        bool holderIdentityUnchanged =
            holderAfter is not null
            && holderAfter.Provider == holderProviderBefore
            && holderAfter.ProviderUserId == holderProviderUserIdBefore
            && holderAfter.UserId == holderIdentityOwnerBefore;
        bool holderHasExactlyOneIdentity = store.Identities.Count(i => i.UserId == holderId) == 1;
        bool holderEmailUnchanged =
            store.FindUser(holderId) is { } holderUser && holderUser.Email == holderEmailBefore;

        return (succeeded
            && brandNewUserCreated
            && sessionNotForHolder
            && freshIdentityCreated
            && freshIdentityOwnedByNewUser
            && holderIdentityUnchanged
            && holderHasExactlyOneIdentity
            && holderEmailUnchanged).ToProperty();
    }
}

/// <summary>
/// A Property-14 scenario: a fresh Google <see cref="AssertionSubject"/> (the <c>sub</c> the assertion
/// carries) plus an email <c>E</c> that a different, pre-existing user already holds. <see
/// cref="HolderUsesGoogle"/> selects how that user holds <c>E</c> — through a Password identity (keyed
/// on the normalised email) or through a Google identity bearing the distinct <see
/// cref="HolderGoogleSubject"/>. The two subjects are guaranteed distinct so the assertion's subject is
/// always genuinely fresh.
/// </summary>
public sealed record GoogleNeverMergeInput(
    string AssertionSubject,
    string HolderGoogleSubject,
    string Email,
    bool EmailVerified,
    bool HolderUsesGoogle);

/// <summary>
/// FsCheck arbitraries for the Google never-merge-on-email property. Smart generators constrain inputs
/// to the valid space the verifier would already have accepted: a present (non-empty, non-whitespace)
/// fresh subject and a distinct holder subject — both drawn from a realistic identifier alphabet and
/// prefixed so they can never collide — plus a syntactically valid email shared by the assertion and
/// the pre-existing holder. Referenced via
/// <c>[Property(Arbitrary = new[] { typeof(GoogleNeverMergeGenerators) })]</c>.
/// </summary>
public static class GoogleNeverMergeGenerators
{
    private static readonly char[] SubjectAlphabet =
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_".ToCharArray();

    private static readonly char[] EmailAlphabet =
        "abcdefghijklmnopqrstuvwxyz0123456789".ToCharArray();

    /// <summary>Arbitrary for a Property-14 scenario.</summary>
    public static Arbitrary<GoogleNeverMergeInput> GoogleNeverMergeInput() =>
        Arb.From(GoogleNeverMergeInputGen());

    private static Gen<GoogleNeverMergeInput> GoogleNeverMergeInputGen() =>
        from assertionRaw in RawSubject()
        from holderRaw in RawSubject()
        from email in CanonicalEmail()
        from emailVerified in Gen.Elements(true, false)
        from holderUsesGoogle in Gen.Elements(true, false)
        // Distinct prefixes guarantee the asserted subject is genuinely fresh — it can never equal the
        // holder's Google subject — so resolution by (Google, sub) never matches the holder.
        select new GoogleNeverMergeInput(
            "asrt-" + assertionRaw,
            "hold-" + holderRaw,
            email,
            emailVerified,
            holderUsesGoogle);

    /// <summary>A present subject body: 1–40 characters from a realistic provider-id alphabet.</summary>
    private static Gen<string> RawSubject() =>
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
