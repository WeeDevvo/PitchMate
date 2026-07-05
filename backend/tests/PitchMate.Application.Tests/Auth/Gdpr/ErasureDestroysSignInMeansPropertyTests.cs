using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Application.Auth.Gdpr;
using PitchMate.Domain.Auth;

namespace PitchMate.Application.Tests.Auth.Gdpr;

/// <summary>
/// Property 36: Erasure destroys all means of signing in as the user.
/// <para>
/// For any mix of an optional Password identity and external identities plus any number of
/// active refresh tokens, a successful erasure leaves no usable sign-in means: every
/// <see cref="PasswordCredential"/> is removed, every <see cref="RefreshToken"/> is revoked
/// (so no active token remains), and every external identity's
/// <see cref="AuthIdentity.ProviderUserId"/> is scrubbed so its original
/// (Provider, ProviderUserId) pair no longer resolves. A second, unrelated user's identity
/// and session are left intact. Exercised over in-memory fakes as a pure Application unit
/// test, at least 100 iterations.
/// </para>
/// </summary>
[Trait("Feature", "auth-and-identity")]
public class ErasureDestroysSignInMeansPropertyTests
{
    // Feature: auth-and-identity, Property 36: Erasure destroys all means of signing in as
    // the user. Validates: Requirements 14.2, 14.3
    [Property(MaxTest = 100)]
    [Trait("Property", "36")]
    public Property Erasure_DestroysEverySignInMeans_WhileLeavingOtherUsersIntact() =>
        Prop.ForAll(Arb.From(ScenarioGen()), scenario =>
        {
            var (hasPassword, externalProviders, activeTokenCount) = scenario;

            var harness = ErasureHarness.Create(hasPassword, externalProviders, activeTokenCount);

            var result = harness.Handler
                .HandleAsync(new EraseUserCommand(harness.UserId), CancellationToken.None)
                .GetAwaiter()
                .GetResult();

            // No password credential of the user's survives.
            bool noCredentialRemains = harness.SeededCredentialIds.All(id =>
                harness.PasswordCredentials.All.All(c => c.Id != id));

            // Every one of the user's refresh tokens is revoked and none remains active.
            bool allTokensRevoked =
                harness.UserRefreshTokens.All(t => t.Status == RefreshTokenStatus.Revoked);
            var remainingActive = harness.RefreshTokens
                .ListActiveForUserAsync(harness.UserId, CancellationToken.None)
                .GetAwaiter()
                .GetResult();
            bool noActiveTokenRemains = remainingActive.Count == 0;

            // None of the user's original external (Provider, ProviderUserId) pairs resolve.
            bool noExternalPairResolves = harness.ExternalIdentities.All(spec =>
                harness.AuthIdentities
                    .FindByProviderKeyAsync(spec.Provider, spec.OriginalProviderUserId, CancellationToken.None)
                    .GetAwaiter()
                    .GetResult() is null);

            // The unrelated user's identity still resolves and their session is untouched.
            var otherResolved = harness.AuthIdentities
                .FindByProviderKeyAsync(
                    AuthProvider.Google, harness.OtherUserOriginalProviderUserId, CancellationToken.None)
                .GetAwaiter()
                .GetResult();
            bool otherUserIntact =
                otherResolved is not null
                && ReferenceEquals(otherResolved, harness.OtherUserIdentity)
                && harness.OtherUserRefreshToken.Status == RefreshTokenStatus.Active;

            return result.IsSuccess
                && noCredentialRemains
                && allTokensRevoked
                && noActiveTokenRemains
                && noExternalPairResolves
                && otherUserIntact;
        });

    private static Gen<(bool HasPassword, IReadOnlyList<AuthProvider> ExternalProviders, int ActiveTokenCount)> ScenarioGen() =>
        from hasPassword in Gen.Elements(true, false)
        from externalCount in Gen.Choose(0, 4)
        from externalProviders in Gen.ListOf(Gen.Elements(AuthProvider.Google, AuthProvider.Apple), externalCount)
        from activeTokenCount in Gen.Choose(0, 6)
        select (hasPassword, (IReadOnlyList<AuthProvider>)externalProviders.ToList(), activeTokenCount);
}
