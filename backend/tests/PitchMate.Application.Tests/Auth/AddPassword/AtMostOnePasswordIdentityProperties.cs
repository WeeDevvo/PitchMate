using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Application.Auth;
using PitchMate.Application.Auth.UseCases;
using PitchMate.Domain.Auth;

namespace PitchMate.Application.Tests.Auth.AddPassword;

/// <summary>
/// Property-based test for the add-password correctness invariant (Requirement 10.9):
/// <list type="bullet">
///   <item><b>Property 32</b> — a User may hold <em>at most one</em> Password
///   <see cref="AuthIdentity"/>. Adding a Password method to a User that already owns one is
///   rejected with <see cref="AuthErrorCode.PasswordMethodExists"/> and leaves the User's
///   existing identities unchanged; adding to a User that owns none (with a policy-compliant
///   password) succeeds and leaves exactly one Password identity. Across any sequence of
///   add-password operations the count of Password identities per user never exceeds one.</item>
/// </list>
/// Each test drives the real <see cref="AddPasswordCredentialHandler"/> against the in-memory
/// add-password fakes (no database), per the Application-layer testing strategy.
/// </summary>
[Trait("Feature", "auth-and-identity")]
public class AtMostOnePasswordIdentityProperties
{
    // Feature: auth-and-identity, Property 32: At most one Password identity per user — adding a
    // Password method to a user that already owns one is rejected and changes nothing.
    // Validates: Requirements 10.9
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(AddPasswordGenerators) })]
    [Trait("Property", "32")]
    public Property Property32_AddingToUserWithExistingPasswordIsRejectedAndChangesNothing(
        ExistingPasswordScenario scenario)
    {
        var store = new AddPasswordStore();
        User user = User.Create("Player", scenario.Email, emailVerified: true);
        store.SeedUser(user);

        // The user already owns a Password identity keyed on its own normalised email...
        store.SeedIdentity(
            AuthIdentity.ForPassword(user.Id, user.Email, PasswordCredential.Create("seeded-hash")));

        // ...plus any number of unrelated external identities that must be left untouched.
        SeedExternalIdentities(store, user.Id, scenario.ExternalSubjects);

        IReadOnlyList<AuthIdentity> before = store.ListForUser(user.Id);
        int identityCountBefore = before.Count;
        int savesBefore = store.SaveCallCount;

        Result<AddPasswordCredentialResult> result = NewHandler(store)
            .HandleAsync(new AddPasswordCredentialCommand(user.Id, scenario.NewPassword), CancellationToken.None)
            .GetAwaiter()
            .GetResult();

        IReadOnlyList<AuthIdentity> after = store.ListForUser(user.Id);

        // Rejected with the "password method already exists" code...
        bool rejected =
            !result.IsSuccess
            && result.Error!.Code == AuthErrorCode.PasswordMethodExists;

        // ...nothing added (count unchanged) and the existing identity set is exactly preserved...
        bool nothingAdded = after.Count == identityCountBefore;
        bool identitiesUnchanged =
            after.Count == before.Count
            && before.All(original => after.Any(current => ReferenceEquals(current, original)));

        // ...the rejection short-circuits before any save...
        bool noSaveAttempted = store.SaveCallCount == savesBefore;

        // ...and the at-most-one invariant holds: still exactly one Password identity.
        bool exactlyOnePassword = after.Count(i => i.Provider == AuthProvider.Password) == 1;

        return (rejected
            && nothingAdded
            && identitiesUnchanged
            && noSaveAttempted
            && exactlyOnePassword).ToProperty();
    }

    // Feature: auth-and-identity, Property 32: At most one Password identity per user — across a
    // sequence of add-password operations the Password-identity count never exceeds one; the first
    // policy-compliant add succeeds and every subsequent add is rejected as already-existing.
    // Validates: Requirements 10.9
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(AddPasswordGenerators) })]
    [Trait("Property", "32")]
    public Property Property32_RepeatedAddsLeaveAtMostOnePasswordIdentity(RepeatedAddScenario scenario)
    {
        var store = new AddPasswordStore();
        User user = User.Create("Player", scenario.Email, emailVerified: true);
        store.SeedUser(user);

        // The user starts with no Password identity, but may own unrelated external identities.
        SeedExternalIdentities(store, user.Id, scenario.ExternalSubjects);

        bool invariantHeldThroughout = true;
        bool outcomesAsExpected = true;
        bool firstObserved = false;

        foreach (string password in scenario.Passwords)
        {
            bool hadPasswordBefore =
                store.ListForUser(user.Id).Any(i => i.Provider == AuthProvider.Password);

            Result<AddPasswordCredentialResult> result = NewHandler(store)
                .HandleAsync(new AddPasswordCredentialCommand(user.Id, password), CancellationToken.None)
                .GetAwaiter()
                .GetResult();

            // The first add (no Password identity yet, policy-compliant password) must succeed;
            // every later add must be rejected as already-existing.
            if (!hadPasswordBefore)
            {
                outcomesAsExpected &= result.IsSuccess;
                firstObserved = true;
            }
            else
            {
                outcomesAsExpected &=
                    !result.IsSuccess && result.Error!.Code == AuthErrorCode.PasswordMethodExists;
            }

            // The at-most-one invariant must hold after every single operation.
            int passwordCount = store.ListForUser(user.Id).Count(i => i.Provider == AuthProvider.Password);
            invariantHeldThroughout &= passwordCount <= 1;
        }

        // The terminal state holds exactly one Password identity, keyed on the user's email.
        IReadOnlyList<AuthIdentity> final = store.ListForUser(user.Id);
        bool exactlyOnePassword = final.Count(i => i.Provider == AuthProvider.Password) == 1;
        bool keyedOnEmail = final
            .Single(i => i.Provider == AuthProvider.Password)
            .ProviderUserId == user.Email;

        return (firstObserved
            && outcomesAsExpected
            && invariantHeldThroughout
            && exactlyOnePassword
            && keyedOnEmail).ToProperty();
    }

    private static AddPasswordCredentialHandler NewHandler(AddPasswordStore store) => new(
        new AddPasswordFakeUserRepository(store),
        new AddPasswordFakeAuthIdentityRepository(store),
        new AddPasswordFakePasswordHasher(),
        new AddPasswordFakeUnitOfWork(store));

    private static void SeedExternalIdentities(
        AddPasswordStore store, Guid userId, IReadOnlyList<string> subjects)
    {
        foreach (string subject in subjects)
        {
            store.SeedIdentity(AuthIdentity.ForExternal(userId, AuthProvider.Google, subject));
        }
    }
}

/// <summary>
/// A user that already owns a Password identity (keyed on <paramref name="Email"/>) plus zero
/// or more distinct external identities, together with a policy-compliant password whose add
/// must be rejected as already-existing.
/// </summary>
public sealed record ExistingPasswordScenario(
    string Email,
    IReadOnlyList<string> ExternalSubjects,
    string NewPassword);

/// <summary>
/// A user that owns no Password identity (but may own distinct external identities), together
/// with a non-empty sequence of policy-compliant passwords applied via repeated add-password
/// operations. The first add succeeds; every later add must be rejected as already-existing.
/// </summary>
public sealed record RepeatedAddScenario(
    string Email,
    IReadOnlyList<string> ExternalSubjects,
    IReadOnlyList<string> Passwords);

/// <summary>
/// FsCheck arbitraries for Property 32. Smart generators constrain inputs to the meaningful
/// space: a syntactically valid normalised email for the user, a set of distinct external
/// provider subjects (so "existing identities unchanged" is meaningfully exercised), and
/// passwords within the 12–128 length policy (so the success branch is reachable and the
/// rejection is attributable solely to an existing Password method, never the policy).
/// Referenced via <c>[Property(Arbitrary = new[] { typeof(AddPasswordGenerators) })]</c>.
/// </summary>
public static class AddPasswordGenerators
{
    private static readonly char[] EmailAlphabet =
        "abcdefghijklmnopqrstuvwxyz0123456789".ToCharArray();

    private static readonly char[] PasswordAlphabet =
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()-_=+".ToCharArray();

    /// <summary>Arbitrary for the existing-Password scenario.</summary>
    public static Arbitrary<ExistingPasswordScenario> ExistingPasswordScenario() =>
        Arb.From(ExistingPasswordScenarioGen());

    /// <summary>Arbitrary for the repeated-add scenario.</summary>
    public static Arbitrary<RepeatedAddScenario> RepeatedAddScenario() =>
        Arb.From(RepeatedAddScenarioGen());

    private static Gen<ExistingPasswordScenario> ExistingPasswordScenarioGen() =>
        from email in CanonicalEmail()
        from subjects in ExternalSubjects()
        from password in ValidPassword()
        select new ExistingPasswordScenario(email, subjects, password);

    private static Gen<RepeatedAddScenario> RepeatedAddScenarioGen() =>
        from email in CanonicalEmail()
        from subjects in ExternalSubjects()
        from attempts in Gen.Choose(1, 4)
        from passwords in ListOfLength(attempts, ValidPassword())
        select new RepeatedAddScenario(email, subjects, passwords);

    /// <summary>
    /// A set of 0–3 distinct external provider subjects, indexed so each is unique (honouring
    /// the unique (Provider, ProviderUserId) constraint among the seeded external identities).
    /// </summary>
    private static Gen<IReadOnlyList<string>> ExternalSubjects() =>
        from count in Gen.Choose(0, 3)
        from words in ListOfLength(count, Word(3, 8))
        select (IReadOnlyList<string>)words
            .Select((word, index) => $"sub-{index}-{word}")
            .ToList();

    /// <summary>A canonical valid email <c>local@label.tld</c> from lowercase letters and digits.</summary>
    private static Gen<string> CanonicalEmail() =>
        from local in Word(1, 20)
        from label in Word(1, 20)
        from tld in Word(2, 6)
        select $"{local}@{label}.{tld}";

    /// <summary>A policy-compliant password: 12–128 characters from a broad printable alphabet.</summary>
    private static Gen<string> ValidPassword() =>
        from length in Gen.Choose(12, 128)
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
