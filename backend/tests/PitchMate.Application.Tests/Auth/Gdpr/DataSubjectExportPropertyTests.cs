using System.Reflection;
using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Application.Auth;
using PitchMate.Application.Auth.Gdpr;
using PitchMate.Domain.Auth;

namespace PitchMate.Application.Tests.Auth.Gdpr;

/// <summary>
/// Property-based test for <see cref="ExportUserDataHandler"/> covering:
/// <list type="bullet">
///   <item><b>Property 38</b> — the data-subject export (DSAR) contains exactly the allowed
///   fields and no secrets (Requirement 14.4).</item>
/// </list>
/// For any existing user owning an arbitrary mix of Password and external identities (whose
/// provider subjects and password-hash material are deliberately distinctive secret strings),
/// the export record exposes <em>exactly</em> the user's display name, email address,
/// email-verification state, and the <see cref="AuthProvider"/> of each owned identity in order —
/// and leaks none of the secret material: no password hash, no refresh-token hash, and no provider
/// subject / <see cref="AuthIdentity.ProviderUserId"/>. A request for a user that does not exist
/// returns a typed <see cref="AuthErrorCode.UserNotFound"/> failure and no record. Each test drives
/// the real handler against the in-memory GDPR export fakes (no database), per the Application-layer
/// testing strategy.
/// </summary>
[Trait("Feature", "auth-and-identity")]
public class DataSubjectExportPropertyTests
{
    // The four — and only four — members the DSAR record is allowed to expose (Requirement 14.4).
    private static readonly string[] AllowedMembers =
        ["DisplayName", "Email", "EmailVerified", "Providers"];

    // Feature: auth-and-identity, Property 38: Data-subject export contains exactly the allowed
    // fields and no secrets. For any existing user, the export holds exactly the display name,
    // email, verification state, and the Provider of each owned identity, and excludes every
    // password hash, refresh-token hash, and stored token hash (and every provider subject).
    // Validates: Requirements 14.4
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(DataSubjectExportGenerators) })]
    [Trait("Property", "38")]
    public Property Property38_ExistingUser_ExportContainsExactlyAllowedFields_AndNoSecrets(
        UserExportScenario scenario)
    {
        var store = new GdprExportStore();

        User user = User.Create(scenario.DisplayName, scenario.Email, scenario.EmailVerified);
        store.SeedUser(user);

        // The secret material the export must never disclose: every provider subject
        // (ProviderUserId) and every persisted password hash.
        var secrets = new List<string>();
        foreach (IdentitySpec spec in scenario.Identities)
        {
            AuthIdentity identity = spec.Provider == AuthProvider.Password
                ? AuthIdentity.ForPassword(user.Id, spec.ProviderUserId, PasswordCredential.Create(spec.PasswordHash!))
                : AuthIdentity.ForExternal(user.Id, spec.Provider, spec.ProviderUserId);

            store.SeedIdentity(identity);
            secrets.Add(spec.ProviderUserId);
            if (spec.PasswordHash is not null)
            {
                secrets.Add(spec.PasswordHash);
            }
        }

        var handler = new ExportUserDataHandler(
            new GdprExportUserRepositoryFake(store),
            new GdprExportAuthIdentityRepositoryFake(store));

        Result<UserDataExport> result = handler
            .HandleAsync(new ExportUserDataCommand(user.Id), CancellationToken.None)
            .GetAwaiter()
            .GetResult();

        bool succeeded = result.IsSuccess && result.Value is not null;
        UserDataExport export = result.Value!;

        // The DTO's public surface is exactly the four allowed members — nothing carries secret
        // material because no other member exists to carry it.
        string[] exposedMembers = typeof(UserDataExport)
            .GetProperties(BindingFlags.Public | BindingFlags.Instance)
            .Select(p => p.Name)
            .OrderBy(n => n, StringComparer.Ordinal)
            .ToArray();
        bool exactlyAllowedMembers = exposedMembers.SequenceEqual(AllowedMembers.OrderBy(n => n, StringComparer.Ordinal));

        // The allowed fields carry exactly the user's non-secret data.
        bool displayNameMatches = succeeded && export.DisplayName == user.DisplayName;
        bool emailMatches = succeeded && export.Email == user.Email;
        bool verificationMatches = succeeded && export.EmailVerified == user.EmailVerified;

        // Providers reflect each owned identity's Provider kind, in order — and nothing more.
        AuthProvider[] expectedProviders = scenario.Identities.Select(s => s.Provider).ToArray();
        bool providersMatch = succeeded && export.Providers.SequenceEqual(expectedProviders);

        // No secret value appears anywhere in the export's disclosed scalar content.
        string disclosed = string.Join(
            "\u0001",
            export.DisplayName,
            export.Email,
            export.EmailVerified.ToString(),
            string.Join(",", export.Providers.Select(p => p.ToString())));
        bool noSecretLeaked = secrets.All(secret => !disclosed.Contains(secret, StringComparison.Ordinal));

        return (succeeded
            && exactlyAllowedMembers
            && displayNameMatches
            && emailMatches
            && verificationMatches
            && providersMatch
            && noSecretLeaked).ToProperty();
    }

    // Feature: auth-and-identity, Property 38: a request for a user that does not exist produces no
    // record and a typed UserNotFound failure. Validates: Requirements 14.4 (with 14.8).
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(DataSubjectExportGenerators) })]
    [Trait("Property", "38")]
    public Property Property38_UnknownUser_ReturnsUserNotFound(UserExportScenario scenario)
    {
        var store = new GdprExportStore();

        // Seed the queried scenario's user and identities, then query a guaranteed-fresh id that
        // belongs to no seeded user.
        User user = User.Create(scenario.DisplayName, scenario.Email, scenario.EmailVerified);
        store.SeedUser(user);
        foreach (IdentitySpec spec in scenario.Identities)
        {
            AuthIdentity identity = spec.Provider == AuthProvider.Password
                ? AuthIdentity.ForPassword(user.Id, spec.ProviderUserId, PasswordCredential.Create(spec.PasswordHash!))
                : AuthIdentity.ForExternal(user.Id, spec.Provider, spec.ProviderUserId);
            store.SeedIdentity(identity);
        }

        Guid unknownId = Guid.NewGuid();
        while (store.FindUser(unknownId) is not null)
        {
            unknownId = Guid.NewGuid();
        }

        var handler = new ExportUserDataHandler(
            new GdprExportUserRepositoryFake(store),
            new GdprExportAuthIdentityRepositoryFake(store));

        Result<UserDataExport> result = handler
            .HandleAsync(new ExportUserDataCommand(unknownId), CancellationToken.None)
            .GetAwaiter()
            .GetResult();

        bool failed = !result.IsSuccess && result.Value is null;
        bool userNotFound = result.Error is { Code: AuthErrorCode.UserNotFound };

        return (failed && userNotFound).ToProperty();
    }
}

/// <summary>
/// A single owned identity to seed: its <see cref="AuthProvider"/>, the provider's own identifier
/// (<see cref="ProviderUserId"/> — a secret subject for external providers, the normalised email for
/// Password), and, for Password identities only, the persisted <see cref="PasswordHash"/>. Both the
/// subject and the hash are distinctive secret strings the export must never disclose.
/// </summary>
public sealed record IdentitySpec(AuthProvider Provider, string ProviderUserId, string? PasswordHash);

/// <summary>
/// An existing user to export: a valid display name (1–100 chars) and email, a verification flag,
/// and an arbitrary mix of owned identities (zero or one Password identity plus any number of
/// external Google/Apple identities).
/// </summary>
public sealed record UserExportScenario(
    string DisplayName,
    string Email,
    bool EmailVerified,
    IReadOnlyList<IdentitySpec> Identities);

/// <summary>
/// FsCheck arbitraries for Property 38. Smart generators constrain inputs to the valid space: a
/// non-empty display name and a canonical email built from a lowercase/digit alphabet, so the
/// non-secret fields never accidentally contain a secret; secret values (provider subjects and
/// password hashes) are minted with an uppercase <c>SECRET_</c> prefix drawn from a disjoint
/// alphabet, so a leak is unambiguous. Each user owns at most one Password identity (per the
/// domain invariant) plus any number of distinct external identities. Referenced via
/// <c>[Property(Arbitrary = new[] { typeof(DataSubjectExportGenerators) })]</c>.
/// </summary>
public static class DataSubjectExportGenerators
{
    private static readonly char[] Lower = "abcdefghijklmnopqrstuvwxyz0123456789".ToCharArray();
    private static readonly char[] SecretAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".ToCharArray();

    /// <summary>Arbitrary for a single user-export scenario.</summary>
    public static Arbitrary<UserExportScenario> UserExportScenario() => Arb.From(ScenarioGen());

    private static Gen<UserExportScenario> ScenarioGen() =>
        from displayLength in Gen.Choose(1, 100)
        from displayName in Word(displayLength)
        from email in CanonicalEmail()
        from emailVerified in Gen.Elements(true, false)
        from hasPassword in Gen.Elements(true, false)
        from numExternal in Gen.Choose(0, 4)
        from externalProviders in ListOfLength(numExternal, Gen.Elements(AuthProvider.Google, AuthProvider.Apple))
        select BuildScenario(displayName, email, emailVerified, hasPassword, externalProviders);

    private static UserExportScenario BuildScenario(
        string displayName,
        string email,
        bool emailVerified,
        bool hasPassword,
        List<AuthProvider> externalProviders)
    {
        var identities = new List<IdentitySpec>();

        if (hasPassword)
        {
            // A Password identity is keyed on its (secret-marked) normalised email and carries a
            // persisted hash; both are distinctive secrets the export must never expose.
            identities.Add(new IdentitySpec(
                AuthProvider.Password,
                $"SECRET_SUBJECT_PWD_{Guid.NewGuid():N}",
                $"SECRET_HASH_{Guid.NewGuid():N}"));
        }

        for (int i = 0; i < externalProviders.Count; i++)
        {
            // Index keeps every external subject distinct, honouring the unique
            // (Provider, ProviderUserId) constraint without coupling to the export under test.
            identities.Add(new IdentitySpec(
                externalProviders[i],
                $"SECRET_SUBJECT_{i}_{Guid.NewGuid():N}",
                PasswordHash: null));
        }

        return new UserExportScenario(displayName, email, emailVerified, identities);
    }

    /// <summary>A canonical valid email <c>local@label.tld</c> from lowercase letters and digits.</summary>
    private static Gen<string> CanonicalEmail() =>
        from local in Word(Gen.Choose(1, 12))
        from label in Word(Gen.Choose(1, 12))
        from tld in Word(Gen.Choose(2, 6))
        select $"{local}@{label}.{tld}";

    private static Gen<string> Word(Gen<int> length) => length.SelectMany(Word);

    /// <summary>A token of exactly <paramref name="length"/> lowercase/digit characters.</summary>
    private static Gen<string> Word(int length) =>
        from chars in ListOfLength(length, Gen.Elements(Lower))
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
