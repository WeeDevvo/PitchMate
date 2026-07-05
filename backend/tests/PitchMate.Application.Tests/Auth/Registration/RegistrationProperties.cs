using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Application.Auth;
using PitchMate.Application.Auth.UseCases;
using PitchMate.Domain.Auth;

namespace PitchMate.Application.Tests.Auth.Registration;

/// <summary>
/// Property-based tests for <see cref="RegisterWithPasswordHandler"/> covering the two
/// registration correctness properties:
/// <list type="bullet">
///   <item><b>Property 10</b> — a successful registration creates a normalised, unverified
///   Password identity atomically (Requirements 2.1, 2.6).</item>
///   <item><b>Property 11</b> — a duplicate registration is rejected per normalised email
///   (Requirement 2.3).</item>
/// </list>
/// Each test drives the real handler against the in-memory registration fakes (no database),
/// per the Application-layer testing strategy.
/// </summary>
public class RegistrationProperties
{
    // Feature: auth-and-identity, Property 10: Successful registration creates a normalised,
    // unverified Password identity atomically.
    // Validates: Requirements 2.1, 2.6
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(RegistrationGenerators) })]
    public Property Property10_SuccessfulRegistrationCreatesNormalisedUnverifiedPasswordIdentityAtomically(
        RegistrationInput input)
    {
        var store = new RegistrationStore();
        var initiator = new RegistrationFakeEmailVerificationInitiator();
        var handler = new RegisterWithPasswordHandler(
            new RegistrationFakeUserRepository(store),
            new RegistrationFakeAuthIdentityRepository(store),
            new RegistrationFakePasswordHasher(),
            initiator,
            new RegistrationFakeUnitOfWork(store));

        Result<RegisterWithPasswordResult> result = handler
            .HandleAsync(new RegisterWithPasswordCommand(input.RawEmail, input.Password), CancellationToken.None)
            .GetAwaiter()
            .GetResult();

        string normalised = EmailAddress.Normalise(input.RawEmail);

        // Exactly one User and one Password AuthIdentity (with its single PasswordCredential)
        // were persisted, the email is recorded unverified, and the identity is keyed on the
        // normalised email and owned by the created user.
        bool succeeded = result.IsSuccess;
        bool exactlyOneUser = store.Users.Count == 1;
        bool exactlyOneIdentity = store.Identities.Count == 1;
        bool userUnverified = exactlyOneUser && !store.Users[0].EmailVerified;

        bool identityShape =
            exactlyOneIdentity
            && store.Identities[0].Provider == AuthProvider.Password
            && store.Identities[0].ProviderUserId == normalised
            && store.Identities[0].Credential is not null;

        bool ownership =
            exactlyOneUser
            && exactlyOneIdentity
            && store.Identities[0].UserId == store.Users[0].Id;

        bool resultPointsToUser =
            succeeded && exactlyOneUser && result.Value!.UserId == store.Users[0].Id;

        // Atomicity: all adds were committed through a single Unit-of-Work save, and
        // verification was initiated exactly once for the now-persisted account (Requirement 2.6).
        bool singleSaveWrappingAllAdds = store.SaveCallCount == 1;
        bool verificationInitiated =
            initiator.InitiateCallCount == 1
            && exactlyOneUser
            && ReferenceEquals(initiator.InitiatedFor[0], store.Users[0]);

        return (succeeded
            && exactlyOneUser
            && exactlyOneIdentity
            && userUnverified
            && identityShape
            && ownership
            && resultPointsToUser
            && singleSaveWrappingAllAdds
            && verificationInitiated).ToProperty();
    }

    // Feature: auth-and-identity, Property 10 (atomicity facet): if the Unit-of-Work save fails,
    // the operation persists no User, AuthIdentity, or PasswordCredential.
    // Validates: Requirements 2.1, 2.6
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(RegistrationGenerators) })]
    public Property Property10_RegistrationPersistsNothingWhenTheSaveFails(RegistrationInput input)
    {
        var store = new RegistrationStore();
        var initiator = new RegistrationFakeEmailVerificationInitiator();
        var handler = new RegisterWithPasswordHandler(
            new RegistrationFakeUserRepository(store),
            new RegistrationFakeAuthIdentityRepository(store),
            new RegistrationFakePasswordHasher(),
            initiator,
            new RegistrationFakeUnitOfWork(store, throwOnSave: true));

        bool threw = false;
        try
        {
            _ = handler
                .HandleAsync(new RegisterWithPasswordCommand(input.RawEmail, input.Password), CancellationToken.None)
                .GetAwaiter()
                .GetResult();
        }
        catch (InvalidOperationException)
        {
            threw = true;
        }

        // The save was attempted exactly once and failed, nothing was committed (atomicity),
        // and verification is never initiated for an account that was not durably created.
        bool saveAttempted = store.SaveCallCount == 1;
        bool nothingPersisted = store.Users.Count == 0 && store.Identities.Count == 0;
        bool noVerification = initiator.InitiateCallCount == 0;

        return (threw && saveAttempted && nothingPersisted && noVerification).ToProperty();
    }

    // Feature: auth-and-identity, Property 11: Duplicate registration is rejected per normalised email.
    // Validates: Requirement 2.3
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(RegistrationGenerators) })]
    public Property Property11_DuplicateRegistrationIsRejectedPerNormalisedEmail(
        DuplicateRegistrationInput input)
    {
        var store = new RegistrationStore();
        var initiator = new RegistrationFakeEmailVerificationInitiator();

        RegisterWithPasswordHandler NewHandler() => new(
            new RegistrationFakeUserRepository(store),
            new RegistrationFakeAuthIdentityRepository(store),
            new RegistrationFakePasswordHasher(),
            initiator,
            new RegistrationFakeUnitOfWork(store));

        // First registration with the email (in one case/whitespace variant) succeeds.
        Result<RegisterWithPasswordResult> first = NewHandler()
            .HandleAsync(
                new RegisterWithPasswordCommand(input.FirstRawEmail, input.FirstPassword),
                CancellationToken.None)
            .GetAwaiter()
            .GetResult();

        int usersAfterFirst = store.Users.Count;
        int identitiesAfterFirst = store.Identities.Count;
        int savesAfterFirst = store.SaveCallCount;
        Guid? existingUserId = store.Users.Count == 1 ? store.Users[0].Id : null;
        string? existingKey = store.Identities.Count == 1 ? store.Identities[0].ProviderUserId : null;

        // Second registration with a variant of the same email (differs only by letter case and
        // surrounding whitespace, so it normalises identically) must be rejected as a duplicate.
        Result<RegisterWithPasswordResult> second = NewHandler()
            .HandleAsync(
                new RegisterWithPasswordCommand(input.SecondRawEmail, input.SecondPassword),
                CancellationToken.None)
            .GetAwaiter()
            .GetResult();

        string normalised = EmailAddress.Normalise(input.FirstRawEmail);

        bool firstSucceeded = first.IsSuccess && usersAfterFirst == 1 && identitiesAfterFirst == 1;

        bool secondRejected =
            !second.IsSuccess
            && second.Error!.Code == AuthErrorCode.EmailAlreadyRegistered;

        // No new rows were created by the rejected duplicate.
        bool noNewRows = store.Users.Count == 1 && store.Identities.Count == 1;

        // The pre-existing User and its identity are left unchanged.
        bool existingUnchanged =
            existingKey == normalised
            && store.Identities[0].ProviderUserId == normalised
            && store.Users[0].Id == existingUserId;

        // The duplicate path returns before any save, so no additional save was attempted.
        bool noExtraSave = store.SaveCallCount == savesAfterFirst;

        return (firstSucceeded && secondRejected && noNewRows && existingUnchanged && noExtraSave)
            .ToProperty();
    }
}

/// <summary>
/// A single valid registration input: a raw (un-normalised) email — which may carry mixed
/// letter case and surrounding whitespace — together with a policy-compliant password whose
/// length is in the inclusive 12–128 range.
/// </summary>
public sealed record RegistrationInput(string RawEmail, string Password);

/// <summary>
/// Two valid registration inputs whose emails differ only by letter case and surrounding
/// whitespace, so they normalise to the same canonical address. Used to prove that a second
/// registration of an email equal under normalisation to an existing one is rejected.
/// </summary>
public sealed record DuplicateRegistrationInput(
    string FirstRawEmail,
    string SecondRawEmail,
    string FirstPassword,
    string SecondPassword);

/// <summary>
/// FsCheck arbitraries for the registration properties. Smart generators constrain inputs to
/// the valid space: syntactically valid <c>local-part@domain</c> emails (so registration is
/// not rejected for an unrelated validation reason), case/whitespace decoration to exercise
/// normalisation, and passwords within the 12–128 length policy. Referenced via
/// <c>[Property(Arbitrary = new[] { typeof(RegistrationGenerators) })]</c>.
/// </summary>
public static class RegistrationGenerators
{
    private static readonly char[] EmailAlphabet =
        "abcdefghijklmnopqrstuvwxyz0123456789".ToCharArray();

    private static readonly char[] PasswordAlphabet =
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()-_=+".ToCharArray();

    /// <summary>Arbitrary for a single valid registration input.</summary>
    public static Arbitrary<RegistrationInput> RegistrationInput() => Arb.From(RegistrationInputGen());

    /// <summary>Arbitrary for a pair of registrations whose emails normalise identically.</summary>
    public static Arbitrary<DuplicateRegistrationInput> DuplicateRegistrationInput() =>
        Arb.From(DuplicateRegistrationInputGen());

    private static Gen<RegistrationInput> RegistrationInputGen() =>
        from canonical in CanonicalEmail()
        from raw in Decorate(canonical)
        from password in ValidPassword()
        select new RegistrationInput(raw, password);

    private static Gen<DuplicateRegistrationInput> DuplicateRegistrationInputGen() =>
        from canonical in CanonicalEmail()
        from firstRaw in Decorate(canonical)
        from secondRaw in Decorate(canonical)
        from firstPassword in ValidPassword()
        from secondPassword in ValidPassword()
        select new DuplicateRegistrationInput(firstRaw, secondRaw, firstPassword, secondPassword);

    /// <summary>
    /// A canonical (already-normalised) valid email of the form <c>local@label.tld</c> built
    /// from lowercase letters and digits, with a dot-bearing domain and a total length well
    /// within the 254-character bound.
    /// </summary>
    private static Gen<string> CanonicalEmail() =>
        from local in Word(1, 20)
        from label in Word(1, 20)
        from tld in Word(2, 6)
        select $"{local}@{label}.{tld}";

    /// <summary>
    /// Decorates a canonical email into a raw input that normalises back to it: optionally
    /// upper-cases all letters (normalisation lower-cases them) and adds 0–3 leading and
    /// trailing spaces (normalisation trims them). The normalised form is therefore unchanged.
    /// </summary>
    private static Gen<string> Decorate(string canonical) =>
        from upper in Gen.Elements(true, false)
        from lead in Gen.Choose(0, 3)
        from trail in Gen.Choose(0, 3)
        let cased = upper ? canonical.ToUpperInvariant() : canonical
        select new string(' ', lead) + cased + new string(' ', trail);

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
