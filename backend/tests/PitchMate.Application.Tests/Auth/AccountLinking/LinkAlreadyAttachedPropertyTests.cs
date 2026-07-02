using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Application.Auth;
using PitchMate.Application.Auth.Abstractions;
using PitchMate.Application.Auth.UseCases;
using PitchMate.Domain.Auth;

namespace PitchMate.Application.Tests.Auth.AccountLinking;

/// <summary>
/// Property-based test for the account-linking rejection invariant (Requirement 10.3):
/// <list type="bullet">
///   <item><b>Property 30</b> — linking an external <c>(Provider, ProviderUserId)</c> that is
///   already attached to <em>any</em> account (the requesting user or a different one) is rejected
///   with <see cref="AuthErrorCode.IdentityAlreadyLinked"/> and changes nothing: no new identity is
///   persisted, the save is never committed, and both the requesting user's and the existing
///   owner's identity sets are left exactly as they were.</item>
/// </list>
/// The production path is <see cref="LinkExternalProviderHandler"/> over
/// <c>IAuthIdentityRepository.FindByProviderKeyAsync</c>, which resolves solely on the pair
/// (<see cref="AuthProvider"/>, <see cref="AuthIdentity.ProviderUserId"/>) — never on email. The
/// test drives the real handler against in-memory fakes (no database), per the Application-layer
/// testing strategy.
/// </summary>
[Trait("Feature", "auth-and-identity")]
public class LinkAlreadyAttachedPropertyTests
{
    // Feature: auth-and-identity, Property 30: Linking an already-attached identity is rejected and
    // changes nothing.
    // Validates: Requirements 10.3
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(LinkAlreadyAttachedGenerators) })]
    [Trait("Property", "30")]
    public Property Property30_LinkingAlreadyAttachedIdentityIsRejectedAndChangesNothing(
        AlreadyAttachedScenario scenario)
    {
        var store = new AccountLinkingStore();

        // The requesting (authenticated) user.
        User requester = User.Create(scenario.RequesterDisplayName, scenario.RequesterEmail, emailVerified: true);
        store.SeedUser(requester);

        // The owner of the already-attached identity: either the requester themselves (re-link of
        // their own identity) or a distinct user (the identity belongs to somebody else). Requirement
        // 10.3 rejects both, leaving every party unchanged.
        User owner;
        if (scenario.OwnerIsRequester)
        {
            owner = requester;
        }
        else
        {
            owner = User.Create(scenario.OwnerDisplayName, scenario.OwnerEmail, emailVerified: false);
            store.SeedUser(owner);
        }

        // The pre-existing external identity occupying the (Provider, ProviderUserId) pair.
        var existing = AuthIdentity.ForExternal(owner.Id, scenario.Provider, scenario.Subject);
        store.SeedIdentity(existing);

        // Optional unrelated identities on each user to prove their whole sets are preserved, not
        // merely their counts. The requester gets a Password identity keyed on their email; the
        // owner (when distinct) gets a separate external identity on a disjoint subject.
        if (scenario.RequesterHasPassword)
        {
            store.SeedIdentity(AuthIdentity.ForPassword(
                requester.Id, EmailAddress.Normalise(scenario.RequesterEmail), PasswordCredential.Create("stored-hash")));
        }

        if (!scenario.OwnerIsRequester && scenario.OwnerHasExtraIdentity)
        {
            store.SeedIdentity(AuthIdentity.ForExternal(owner.Id, scenario.Provider, scenario.Subject + "-other"));
        }

        // Snapshot both parties' identity sets (by identity id) before the attempt.
        var requesterIdentitiesBefore = IdentityIds(store, requester.Id);
        var ownerIdentitiesBefore = IdentityIds(store, owner.Id);
        int totalIdentitiesBefore = store.Identities.Count;

        // The verifier validates and returns the exact (Provider, Subject) that is already attached;
        // the asserted email is independent and never a resolution key (Requirement 10.4).
        var verifier = AccountLinkingVerifierFake.Returning(
            new ExternalIdentity(scenario.Provider, scenario.Subject, scenario.AssertedEmail, scenario.AssertedEmailVerified));
        var unitOfWork = new AccountLinkingUnitOfWorkFake(store);

        var handler = new LinkExternalProviderHandler(
            verifier,
            new AccountLinkingUserRepositoryFake(store),
            new AccountLinkingAuthIdentityRepositoryFake(store),
            unitOfWork);

        Result<LinkExternalProviderResult> result = handler
            .HandleAsync(new LinkExternalProviderCommand(requester.Id, scenario.Provider, "assertion"), CancellationToken.None)
            .GetAwaiter()
            .GetResult();

        // Rejected with the specific code, carrying no value.
        bool rejectedAsAlreadyLinked =
            !result.IsSuccess
            && result.Value is null
            && result.Error is { Code: AuthErrorCode.IdentityAlreadyLinked };

        // Nothing persisted: no new identity row, and the save was never committed.
        bool nothingPersisted =
            store.Identities.Count == totalIdentitiesBefore
            && store.SaveCallCount == 0;

        // Both users' identity sets are byte-for-byte the set they started with.
        bool requesterUnchanged = IdentityIds(store, requester.Id).SetEquals(requesterIdentitiesBefore);
        bool ownerUnchanged = IdentityIds(store, owner.Id).SetEquals(ownerIdentitiesBefore);

        return (rejectedAsAlreadyLinked && nothingPersisted && requesterUnchanged && ownerUnchanged)
            .ToProperty();
    }

    private static HashSet<Guid> IdentityIds(AccountLinkingStore store, Guid userId) =>
        store.Identities.Where(i => i.UserId == userId).Select(i => i.Id).ToHashSet();
}

/// <summary>
/// An already-attached scenario: a requesting user, the owner of an external identity that occupies
/// some (<paramref name="Provider"/>, <paramref name="Subject"/>) pair — possibly the requester
/// themselves — plus optional extra identities, and the assertion the verifier returns for that same
/// pair (with an independent email claim).
/// </summary>
public sealed record AlreadyAttachedScenario(
    AuthProvider Provider,
    string Subject,
    string RequesterDisplayName,
    string RequesterEmail,
    bool RequesterHasPassword,
    bool OwnerIsRequester,
    string OwnerDisplayName,
    string OwnerEmail,
    bool OwnerHasExtraIdentity,
    string? AssertedEmail,
    bool AssertedEmailVerified);

/// <summary>
/// FsCheck arbitraries for Property 30. Smart generators constrain inputs to the meaningful space:
/// an external (non-Password) provider, a non-empty subject, syntactically valid emails, and the
/// independent toggles that decide whether the identity belongs to the requester or a distinct user
/// and which extra identities exist. Referenced via
/// <c>[Property(Arbitrary = new[] { typeof(LinkAlreadyAttachedGenerators) })]</c>.
/// </summary>
public static class LinkAlreadyAttachedGenerators
{
    private static readonly char[] Alphabet = "abcdefghijklmnopqrstuvwxyz0123456789".ToCharArray();

    /// <summary>Arbitrary for a single already-attached scenario.</summary>
    public static Arbitrary<AlreadyAttachedScenario> AlreadyAttachedScenario() => Arb.From(ScenarioGen());

    private static Gen<AlreadyAttachedScenario> ScenarioGen() =>
        // Both external providers exercise the rejection path; Password is excluded because it is
        // never linked through this handler.
        from provider in Gen.Elements(AuthProvider.Google, AuthProvider.Apple)
        from subjectWord in Word(3, 16)
        from requesterDisplay in Word(1, 20)
        from requesterEmail in CanonicalEmail()
        from requesterHasPassword in Gen.Elements(true, false)
        from ownerIsRequester in Gen.Elements(true, false)
        from ownerDisplay in Word(1, 20)
        from ownerEmail in CanonicalEmail()
        from ownerHasExtraIdentity in Gen.Elements(true, false)
        // 0 => no email claim; 1..5 => the requester's own email (proving email is never a key);
        // 6..9 => a guaranteed-fresh email.
        from emailModeRoll in Gen.Choose(0, 9)
        from freshEmailWord in Word(1, 20)
        from assertedEmailVerified in Gen.Elements(true, false)
        select new AlreadyAttachedScenario(
            provider,
            $"sub-{subjectWord}",
            requesterDisplay,
            requesterEmail,
            requesterHasPassword,
            ownerIsRequester,
            ownerDisplay,
            ownerEmail,
            ownerHasExtraIdentity,
            emailModeRoll switch
            {
                0 => null,
                <= 5 => requesterEmail,
                _ => $"missing-{freshEmailWord}@example.test",
            },
            assertedEmailVerified);

    /// <summary>A canonical valid email <c>local@label.tld</c> from lowercase letters and digits.</summary>
    private static Gen<string> CanonicalEmail() =>
        from local in Word(1, 12)
        from label in Word(1, 12)
        from tld in Word(2, 6)
        select $"{local}@{label}.{tld}";

    /// <summary>A non-empty token of <paramref name="minLength"/>–<paramref name="maxLength"/> lowercase/digit characters.</summary>
    private static Gen<string> Word(int minLength, int maxLength) =>
        from length in Gen.Choose(minLength, maxLength)
        from chars in ListOfLength(length, Gen.Elements(Alphabet))
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
