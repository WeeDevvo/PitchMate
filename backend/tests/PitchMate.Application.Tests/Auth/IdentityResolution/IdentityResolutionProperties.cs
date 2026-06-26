using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Application.Auth;
using PitchMate.Application.Auth.Abstractions;
using PitchMate.Application.Auth.UseCases;
using PitchMate.Application.Tests.Auth.GoogleSignIn;
using PitchMate.Domain.Auth;

namespace PitchMate.Application.Tests.Auth.IdentityResolution;

/// <summary>
/// Property-based test for the identity-resolution invariant shared by every sign-in path
/// (Requirements 1.4, 1.11, 7.4, 10.4):
/// <list type="bullet">
///   <item><b>Property 9</b> — identity resolution matches solely on the pair
///   (<see cref="AuthProvider"/>, <see cref="AuthIdentity.ProviderUserId"/>) and never on
///   <c>Email_Address</c> or any other attribute.</item>
/// </list>
/// The production resolution path is <see cref="SignInWithGoogleHandler"/> over
/// <c>IAuthIdentityRepository.FindByProviderKeyAsync</c>. Google is the discriminating vehicle
/// because its provider key (the Google subject) is distinct from the email claim, so a directory
/// can contain distinct users that share an <c>Email_Address</c> — including a Password identity
/// whose provider key (its email) equals the asserted email — and the test can prove resolution
/// keys off the subject alone:
/// <list type="bullet">
///   <item>When some stored <see cref="AuthProvider.Google"/> identity has the asserted subject,
///   sign-in resolves to <em>that</em> identity's owning user and creates nothing — regardless of
///   whether the asserted email matches that user, a different user, several users, or none
///   (Requirements 1.4, 7.4).</item>
///   <item>When no stored <see cref="AuthProvider.Google"/> identity has the asserted subject,
///   resolution reports no matching user: a brand-new user is created and the session is never
///   attached to any pre-existing user — even one holding the asserted email, and even when a
///   Password identity already carries that email as its own provider key (Requirements 1.11,
///   10.4 — never matched/merged on a shared email).</item>
/// </list>
/// The test drives the real handler against the in-memory Google sign-in fakes (no database),
/// per the Application-layer testing strategy.
/// </summary>
[Trait("Feature", "auth-and-identity")]
public class IdentityResolutionProperties
{
    // Feature: auth-and-identity, Property 9: Identity resolution matches solely on the pair
    // (Provider, Provider_User_Id) and never on Email_Address or any other attribute.
    // Validates: Requirements 1.4, 1.11, 7.4, 10.4
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(IdentityResolutionGenerators) })]
    [Trait("Property", "9")]
    public Property Property9_ResolutionMatchesSolelyOnProviderKey(ResolutionScenario scenario)
    {
        var store = new GoogleSignInStore();

        // Seed the directory. Distinct users may share an Email_Address (the crux of Property 9):
        // Google identities are keyed on their subject; Password identities are keyed on their
        // (normalised) email. The same email can therefore appear on several users without ever
        // being a resolution key. The store models the unique (Provider, ProviderUserId) index by
        // skipping any duplicate Password email so the directory stays well-formed.
        var subjectToOwner = new Dictionary<string, Guid>(StringComparer.Ordinal);
        var seededPasswordEmails = new HashSet<string>(StringComparer.Ordinal);

        foreach (DirectoryGoogleAccount account in scenario.GoogleAccounts)
        {
            User owner = User.Create(account.DisplayName, account.Email, emailVerified: false);
            store.SeedUser(owner);
            store.SeedIdentity(AuthIdentity.ForExternal(owner.Id, AuthProvider.Google, account.Subject));
            subjectToOwner[account.Subject] = owner.Id;
        }

        foreach (DirectoryPasswordAccount account in scenario.PasswordAccounts)
        {
            string normalised = EmailAddress.Normalise(account.Email);
            if (!seededPasswordEmails.Add(normalised))
            {
                continue;
            }

            User owner = User.Create(account.DisplayName, account.Email, emailVerified: true);
            store.SeedUser(owner);
            store.SeedIdentity(
                AuthIdentity.ForPassword(owner.Id, normalised, PasswordCredential.Create("stored-hash")));
        }

        int usersBefore = store.Users.Count;
        int identitiesBefore = store.Identities.Count;
        var preExistingUserIds = store.Users.Select(u => u.Id).ToHashSet();

        // The source of truth for "does the pair match?" is the seeded directory itself, computed
        // solely on (Google, subject) — never on the query email.
        bool expectMatch = subjectToOwner.ContainsKey(scenario.QuerySubject);

        var handler = new SignInWithGoogleHandler(
            GoogleSignInVerifierFake.Returning(
                new ExternalIdentity(
                    AuthProvider.Google,
                    scenario.QuerySubject,
                    scenario.QueryEmail,
                    scenario.QueryEmailVerified)),
            new GoogleSignInUserRepositoryFake(store),
            new GoogleSignInAuthIdentityRepositoryFake(store),
            new GoogleSignInTokenServiceFake(),
            new GoogleSignInRefreshTokenStoreFake(store),
            new GoogleSignInUnitOfWorkFake(store));

        Result<AuthSession> result = handler
            .HandleAsync(new SignInWithGoogleCommand("assertion"), CancellationToken.None)
            .GetAwaiter()
            .GetResult();

        // A validated assertion bearing a subject always yields a session; the discriminating
        // question is *which* user it resolves/creates and whether email ever influenced it.
        bool succeeded = result.IsSuccess && result.Value is not null;
        Guid resolvedUserId = succeeded ? result.Value!.UserId : Guid.Empty;

        bool outcome;
        if (expectMatch)
        {
            // Resolved solely by the (Google, subject) pair to that identity's owning user, and
            // nothing new was created — independent of the asserted email (Requirements 1.4, 7.4).
            outcome =
                succeeded
                && resolvedUserId == subjectToOwner[scenario.QuerySubject]
                && preExistingUserIds.Contains(resolvedUserId)
                && store.Users.Count == usersBefore
                && store.Identities.Count == identitiesBefore;
        }
        else
        {
            // No pair matched: a brand-new user was created and the session is never attached to a
            // pre-existing user — even one holding the asserted email, and even when a Password
            // identity already carries that email as its provider key (Requirements 1.11, 10.4).
            bool exactlyOneNewUser = store.Users.Count == usersBefore + 1;
            bool exactlyOneNewIdentity = store.Identities.Count == identitiesBefore + 1;
            bool neverMergedOnEmail = succeeded && !preExistingUserIds.Contains(resolvedUserId);

            AuthIdentity? createdIdentity = store.Identities
                .FirstOrDefault(i => i.Provider == AuthProvider.Google
                    && i.ProviderUserId == scenario.QuerySubject);
            bool createdIdentityIsForNewUser =
                createdIdentity is not null
                && createdIdentity.UserId == resolvedUserId
                && createdIdentity.Credential is null;

            outcome =
                succeeded
                && exactlyOneNewUser
                && exactlyOneNewIdentity
                && neverMergedOnEmail
                && createdIdentityIsForNewUser;
        }

        return outcome.ToProperty();
    }
}

/// <summary>A stored Google account: an owning user (with an email) and its Google subject.</summary>
public sealed record DirectoryGoogleAccount(string DisplayName, string Email, string Subject);

/// <summary>A stored Password account: an owning user keyed on its (normalised) email.</summary>
public sealed record DirectoryPasswordAccount(string DisplayName, string Email);

/// <summary>
/// A resolution scenario: a directory of Google and Password accounts (whose users may share an
/// <c>Email_Address</c>) together with an incoming Google assertion's subject and email claim.
/// The asserted subject either reuses one already in the directory (a hit) or is guaranteed fresh
/// (a miss); the asserted email is independently absent, an email already present in the directory,
/// or a fresh one — so the test exercises resolution under every email/subject alignment.
/// </summary>
public sealed record ResolutionScenario(
    IReadOnlyList<DirectoryGoogleAccount> GoogleAccounts,
    IReadOnlyList<DirectoryPasswordAccount> PasswordAccounts,
    string QuerySubject,
    string? QueryEmail,
    bool QueryEmailVerified);

/// <summary>
/// FsCheck arbitraries for Property 9. Smart generators constrain inputs to the meaningful space:
/// syntactically valid emails drawn from a small shared pool (so distinct users genuinely share an
/// <c>Email_Address</c>), Google subjects made distinct by index, and a query whose subject is
/// either an existing one (hit) or guaranteed-fresh (miss) and whose email is null, an existing
/// pool email, or a guaranteed-fresh email. Referenced via
/// <c>[Property(Arbitrary = new[] { typeof(IdentityResolutionGenerators) })]</c>.
/// </summary>
public static class IdentityResolutionGenerators
{
    private static readonly char[] Alphabet = "abcdefghijklmnopqrstuvwxyz0123456789".ToCharArray();

    /// <summary>Arbitrary for a single resolution scenario.</summary>
    public static Arbitrary<ResolutionScenario> ResolutionScenario() => Arb.From(ScenarioGen());

    private static Gen<ResolutionScenario> ScenarioGen() =>
        from poolSize in Gen.Choose(1, 3)
        from pool in ListOfLength(poolSize, CanonicalEmail())
        from numGoogle in Gen.Choose(0, 4)
        from googleEmailPicks in ListOfLength(numGoogle, Gen.Choose(0, poolSize - 1))
        from googleDisplays in ListOfLength(numGoogle, Word(1, 20))
        from googleSubjectWords in ListOfLength(numGoogle, Word(3, 8))
        from numPassword in Gen.Choose(0, 3)
        from passwordEmailPicks in ListOfLength(numPassword, Gen.Choose(0, poolSize - 1))
        from passwordDisplays in ListOfLength(numPassword, Word(1, 20))
        from hitWhenPossible in Gen.Elements(true, false)
        from hitPick in Gen.Choose(0, numGoogle > 0 ? numGoogle - 1 : 0)
        from missSubjectWord in Word(3, 8)
        // 0 => no email claim; 1..5 => an email already in the pool; 6..9 => a guaranteed-fresh email.
        from emailModeRoll in Gen.Choose(0, 9)
        from existingEmailPick in Gen.Choose(0, poolSize - 1)
        from freshEmailWord in Word(1, 20)
        from queryEmailVerified in Gen.Elements(true, false)
        select BuildScenario(
            pool,
            numGoogle, googleEmailPicks, googleDisplays, googleSubjectWords,
            numPassword, passwordEmailPicks, passwordDisplays,
            hitWhenPossible, hitPick, missSubjectWord,
            emailModeRoll, existingEmailPick, freshEmailWord, queryEmailVerified);

    private static ResolutionScenario BuildScenario(
        List<string> pool,
        int numGoogle,
        List<int> googleEmailPicks,
        List<string> googleDisplays,
        List<string> googleSubjectWords,
        int numPassword,
        List<int> passwordEmailPicks,
        List<string> passwordDisplays,
        bool hitWhenPossible,
        int hitPick,
        string missSubjectWord,
        int emailModeRoll,
        int existingEmailPick,
        string freshEmailWord,
        bool queryEmailVerified)
    {
        var google = new List<DirectoryGoogleAccount>(numGoogle);
        for (int i = 0; i < numGoogle; i++)
        {
            // Index the subject so every stored Google subject is distinct, honouring the unique
            // (Provider, ProviderUserId) constraint; the "sub-" prefix keeps it disjoint from the
            // "missing-" miss subject below.
            string subject = $"sub-{i}-{googleSubjectWords[i]}";
            google.Add(new DirectoryGoogleAccount(googleDisplays[i], pool[googleEmailPicks[i]], subject));
        }

        var password = new List<DirectoryPasswordAccount>(numPassword);
        for (int i = 0; i < numPassword; i++)
        {
            password.Add(new DirectoryPasswordAccount(passwordDisplays[i], pool[passwordEmailPicks[i]]));
        }

        // The asserted subject: reuse an existing one (hit) when asked and possible, otherwise a
        // guaranteed-fresh subject (miss). "missing-" can never equal a "sub-" prefixed subject.
        string querySubject = hitWhenPossible && numGoogle > 0
            ? google[hitPick].Subject
            : $"missing-{missSubjectWord}";

        // The asserted email is independent of the subject: absent, an existing pool email, or a
        // guaranteed-fresh email (its hyphenated local part can never be produced by the pool).
        string? queryEmail = emailModeRoll switch
        {
            0 => null,
            <= 5 => pool[existingEmailPick],
            _ => $"missing-{freshEmailWord}@example.test",
        };

        return new ResolutionScenario(google, password, querySubject, queryEmail, queryEmailVerified);
    }

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
