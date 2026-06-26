using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Application.Auth;
using PitchMate.Application.Auth.Abstractions;
using PitchMate.Application.Auth.UseCases;
using PitchMate.Domain.Auth;

namespace PitchMate.Application.Tests.Auth.SignIn;

/// <summary>
/// Property 22: Successful sign-in persists only the refresh-token hash.
/// <para>
/// For any successful password sign-in, the plaintext refresh token is returned to the caller
/// while the revocation store persists only its one-way hash (never the plaintext). The stored
/// row begins as the single active member of a fresh token family, with an expiry equal to the
/// clock instant plus the configured refresh-token lifetime. Exercised over in-memory fakes as a
/// pure Application unit test, at least 100 iterations.
/// </para>
/// </summary>
[Trait("Feature", "auth-and-identity")]
public class PersistsOnlyRefreshHashPropertyTests
{
    // Feature: auth-and-identity, Property 22: Successful sign-in persists only the
    // refresh-token hash.
    // Validates: Requirements 6.5, 9.1
    [Property(MaxTest = 100)]
    [Trait("Property", "22")]
    public Property SuccessfulSignIn_PersistsOnlyTheRefreshTokenHash() =>
        Prop.ForAll(Arb.From(SignInScenarioGen()), scenario =>
        {
            // Anchor the clock so the refresh-token expiry is deterministic.
            var clock = new SignInFakeClock(scenario.ClockInstant);
            var tokenService = new SignInFakeTokenService(clock)
            {
                RefreshTokenLifetime = scenario.RefreshLifetime,
            };
            var refreshTokens = new SignInFakeRefreshTokenStore();

            // Seed a user with a Password identity whose credential matches the password.
            var user = User.Create(scenario.DisplayName, scenario.Email);
            var credential = PasswordCredential.Create(SignInFakePasswordHasher.HashFor(scenario.Password));
            var identity = AuthIdentity.ForPassword(user.Id, scenario.Email, credential);

            var users = new SignInFakeUserRepository();
            users.Seed(user);
            var identities = new SignInFakeAuthIdentityRepository();
            identities.Seed(identity);

            var handler = new SignInWithPasswordHandler(
                identities,
                users,
                new SignInFakePasswordHasher(),
                tokenService,
                refreshTokens,
                new SignInFakeAttemptTracker(),
                new SignInFakeUnitOfWork(),
                clock,
                new SignInProtectionOptions());

            Result<AuthSession> result = handler
                .HandleAsync(new SignInWithPasswordCommand(scenario.Email, scenario.Password), CancellationToken.None)
                .GetAwaiter()
                .GetResult();

            // The sign-in succeeds and returns the one-time plaintext refresh token to the caller.
            bool succeeded = result.IsSuccess && result.Value is not null;
            string plaintext = result.Value!.RefreshToken;
            RefreshTokenSecret issued = tokenService.LastRefreshSecret!;
            bool plaintextReturnedToCaller = succeeded && plaintext == issued.Plaintext;

            // Exactly one refresh token was persisted.
            bool exactlyOnePersisted = refreshTokens.Tokens.Count == 1;
            RefreshToken stored = refreshTokens.Tokens[0];

            // The persisted value is ONLY the hash of the generated secret — equal to the
            // independently recomputed SHA-256 of the returned plaintext.
            bool storedIsHashOfSecret =
                exactlyOnePersisted
                && stored.TokenHash == SignInRefreshHashing.Hash(plaintext);

            // The plaintext never appears in any persisted field of the stored token.
            bool plaintextNotPersistedAnywhere =
                exactlyOnePersisted
                && stored.TokenHash != plaintext
                && !stored.TokenHash.Contains(plaintext, StringComparison.Ordinal);

            // The stored row is the head of a new family: active, owned by the user, with a
            // family id, and the sole member of that family.
            bool freshActiveFamilyHead =
                exactlyOnePersisted
                && stored.UserId == user.Id
                && stored.Status == RefreshTokenStatus.Active
                && stored.IsActiveAt(scenario.ClockInstant)
                && stored.TokenFamilyId != Guid.Empty
                && refreshTokens.Tokens.Count(t => t.TokenFamilyId == stored.TokenFamilyId) == 1;

            // Expiry is the clock instant plus the configured refresh-token lifetime, and the
            // expiry surfaced to the caller matches the stored row.
            bool expiryFromClockPlusLifetime =
                exactlyOnePersisted
                && stored.ExpiresAt == scenario.ClockInstant + scenario.RefreshLifetime
                && result.Value!.RefreshTokenExpiresAt == stored.ExpiresAt;

            return succeeded
                && plaintextReturnedToCaller
                && exactlyOnePersisted
                && storedIsHashOfSecret
                && plaintextNotPersistedAnywhere
                && freshActiveFamilyHead
                && expiryFromClockPlusLifetime;
        });

    private static Gen<SignInScenario> SignInScenarioGen() =>
        from email in ValidEmail()
        from password in PolicyCompliantPassword()
        from displayName in DisplayName()
        from clockSeconds in Gen.Choose(1_577_836_800, 1_893_456_000) // 2020-01-01 .. 2030-01-01 (UTC)
        from lifetimeMinutes in Gen.Choose(1, 60 * 24 * 90) // 1 minute .. 90 days
        select new SignInScenario(
            email,
            password,
            displayName,
            DateTimeOffset.FromUnixTimeSeconds(clockSeconds),
            TimeSpan.FromMinutes(lifetimeMinutes));

    private static readonly char[] LowerAlphaNumeric =
        "abcdefghijklmnopqrstuvwxyz0123456789".ToCharArray();

    private static readonly char[] PasswordAlphabet =
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()-_=+".ToCharArray();

    // A raw email accepted by EmailAddress.Create and already in canonical (lower-case, trimmed)
    // form, so it equals its own normalised value and resolves to the seeded identity.
    private static Gen<string> ValidEmail() =>
        from local in NonEmptyWord(1, 20)
        from label in NonEmptyWord(1, 20)
        from tld in NonEmptyWord(2, 6)
        select $"{local}@{label}.{tld}";

    // A policy-compliant, non-empty password (12-128 characters) so input validation passes.
    private static Gen<string> PolicyCompliantPassword() =>
        from length in Gen.Choose(PasswordPolicy.MinLength, PasswordPolicy.MaxLength)
        from value in StringOfLength(length, PasswordAlphabet)
        select value;

    // A valid display name (1-100 characters).
    private static Gen<string> DisplayName() =>
        from length in Gen.Choose(1, 100)
        from value in StringOfLength(length, LowerAlphaNumeric)
        select value;

    private static Gen<string> NonEmptyWord(int minLength, int maxLength) =>
        from length in Gen.Choose(minLength, maxLength)
        from value in StringOfLength(length, LowerAlphaNumeric)
        select value;

    // Builds a generator for a string of exactly <paramref name="length"/> characters drawn
    // from <paramref name="alphabet"/>.
    private static Gen<string> StringOfLength(int length, char[] alphabet)
    {
        Gen<char> element = Gen.Elements(alphabet);
        Gen<List<char>> chars = Gen.Constant(new List<char>());
        for (int i = 0; i < length; i++)
        {
            chars = chars.SelectMany(list => element.Select(c =>
            {
                var next = new List<char>(list) { c };
                return next;
            }));
        }

        return chars.Select(list => new string(list.ToArray()));
    }
}

/// <summary>
/// A single successful sign-in scenario: a canonical email and matching password, a display
/// name for the seeded user, the clock instant, and the configured refresh-token lifetime.
/// </summary>
public sealed record SignInScenario(
    string Email,
    string Password,
    string DisplayName,
    DateTimeOffset ClockInstant,
    TimeSpan RefreshLifetime);
