using PitchMate.Application.Auth;
using PitchMate.Application.Auth.Abstractions;
using PitchMate.Application.Auth.UseCases;
using PitchMate.Domain.Auth;

namespace PitchMate.Application.Tests.Auth.GoogleSignIn;

/// <summary>
/// Example/unit tests for <see cref="SignInWithGoogleHandler"/> covering the Google sign-in outcomes
/// against in-memory fakes (Requirements 7.3–7.9): resolve-or-create solely by subject, never merging
/// on email, mirroring the <c>email_verified</c> claim onto a created user, and establishing a session
/// that persists only the refresh-token hash. The named-property invariants (Properties 9, 13, 14, 15)
/// are covered separately by tasks 11.6–11.9.
/// </summary>
[Trait("Feature", "auth-and-identity")]
public class SignInWithGoogleHandlerTests
{
    private const string Subject = "google-subject-1234567890";

    private sealed class Harness
    {
        public required GoogleSignInStore Store { get; init; }
        public required GoogleSignInVerifierFake Verifier { get; init; }
        public required GoogleSignInTokenServiceFake TokenService { get; init; }
        public required SignInWithGoogleHandler Handler { get; init; }

        public static Harness For(GoogleSignInVerifierFake verifier, bool throwOnSave = false)
        {
            var store = new GoogleSignInStore();
            var tokenService = new GoogleSignInTokenServiceFake();
            var handler = new SignInWithGoogleHandler(
                verifier,
                new GoogleSignInUserRepositoryFake(store),
                new GoogleSignInAuthIdentityRepositoryFake(store),
                tokenService,
                new GoogleSignInRefreshTokenStoreFake(store),
                new GoogleSignInUnitOfWorkFake(store, throwOnSave));

            return new Harness
            {
                Store = store,
                Verifier = verifier,
                TokenService = tokenService,
                Handler = handler,
            };
        }
    }

    private static ExternalIdentity GoogleAssertion(string subject, string? email, bool emailVerified) =>
        new(AuthProvider.Google, subject, email, emailVerified);

    [Fact]
    public async Task NewSubject_CreatesUserAndGoogleIdentity_AndEstablishesSession()
    {
        var harness = Harness.For(
            GoogleSignInVerifierFake.Returning(GoogleAssertion(Subject, "person@gmail.com", emailVerified: true)));

        Result<AuthSession> result =
            await harness.Handler.HandleAsync(new SignInWithGoogleCommand("assertion"), CancellationToken.None);

        Assert.True(result.IsSuccess);

        // Exactly one new user and one new Google identity keyed on the subject, owned by that user.
        Assert.Single(harness.Store.Users);
        Assert.Single(harness.Store.Identities);
        AuthIdentity identity = harness.Store.Identities[0];
        Assert.Equal(AuthProvider.Google, identity.Provider);
        Assert.Equal(Subject, identity.ProviderUserId);
        Assert.Equal(harness.Store.Users[0].Id, identity.UserId);
        Assert.Null(identity.Credential);

        // The session is for the created user and an access token was issued for them.
        Assert.Equal(harness.Store.Users[0].Id, result.Value!.UserId);
        Assert.Contains(result.Value.UserId, harness.TokenService.IssuedFor);
        Assert.False(string.IsNullOrEmpty(result.Value.AccessToken));
        Assert.False(string.IsNullOrEmpty(result.Value.RefreshToken));
    }

    [Fact]
    public async Task CreatedUser_EmailVerified_MirrorsTheClaim_WhenVerified()
    {
        var harness = Harness.For(
            GoogleSignInVerifierFake.Returning(GoogleAssertion(Subject, "v@gmail.com", emailVerified: true)));

        await harness.Handler.HandleAsync(new SignInWithGoogleCommand("assertion"), CancellationToken.None);

        Assert.True(harness.Store.Users[0].EmailVerified);
        Assert.Equal("v@gmail.com", harness.Store.Users[0].Email);
    }

    [Fact]
    public async Task CreatedUser_EmailVerified_MirrorsTheClaim_WhenNotVerified()
    {
        var harness = Harness.For(
            GoogleSignInVerifierFake.Returning(GoogleAssertion(Subject, "u@gmail.com", emailVerified: false)));

        await harness.Handler.HandleAsync(new SignInWithGoogleCommand("assertion"), CancellationToken.None);

        Assert.False(harness.Store.Users[0].EmailVerified);
    }

    [Fact]
    public async Task ExistingGoogleIdentity_EstablishesSessionForOwner_AndCreatesNothing()
    {
        var owner = User.Create("Existing Owner", "owner@gmail.com", emailVerified: true);
        var existing = AuthIdentity.ForExternal(owner.Id, AuthProvider.Google, Subject);

        var harness = Harness.For(
            GoogleSignInVerifierFake.Returning(GoogleAssertion(Subject, "owner@gmail.com", emailVerified: true)));
        harness.Store.SeedUser(owner);
        harness.Store.SeedIdentity(existing);

        Result<AuthSession> result =
            await harness.Handler.HandleAsync(new SignInWithGoogleCommand("assertion"), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(owner.Id, result.Value!.UserId);

        // No new user or identity was created.
        Assert.Single(harness.Store.Users);
        Assert.Single(harness.Store.Identities);

        // A refresh-token family was started for the owner; only the hash is persisted.
        Assert.Single(harness.Store.RefreshTokens);
        Assert.Equal(owner.Id, harness.Store.RefreshTokens[0].UserId);
    }

    [Fact]
    public async Task FreshSubjectWithEmailOfAnotherUser_NeverMerges_CreatesBrandNewUser()
    {
        // An existing user already holds the email via a Password identity.
        const string sharedEmail = "shared@gmail.com";
        var holder = User.Create("Email Holder", sharedEmail, emailVerified: true);
        var passwordIdentity = AuthIdentity.ForPassword(
            holder.Id, sharedEmail, PasswordCredential.Create("stored-hash"));

        var harness = Harness.For(
            GoogleSignInVerifierFake.Returning(GoogleAssertion(Subject, sharedEmail, emailVerified: true)));
        harness.Store.SeedUser(holder);
        harness.Store.SeedIdentity(passwordIdentity);

        Result<AuthSession> result =
            await harness.Handler.HandleAsync(new SignInWithGoogleCommand("assertion"), CancellationToken.None);

        Assert.True(result.IsSuccess);

        // A brand-new user was created; it is NOT the email holder (no merge on email — Requirement 7.6).
        Assert.Equal(2, harness.Store.Users.Count);
        Assert.NotEqual(holder.Id, result.Value!.UserId);

        // The new Google identity belongs to the new user, not the email holder.
        AuthIdentity googleIdentity =
            harness.Store.Identities.Single(i => i.Provider == AuthProvider.Google);
        Assert.Equal(result.Value.UserId, googleIdentity.UserId);
        Assert.NotEqual(holder.Id, googleIdentity.UserId);
    }

    [Fact]
    public async Task RejectedAssertion_FailsAuthentication_AndCreatesNothing()
    {
        var harness = Harness.For(GoogleSignInVerifierFake.Rejecting());

        Result<AuthSession> result =
            await harness.Handler.HandleAsync(new SignInWithGoogleCommand("bad-assertion"), CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Equal(AuthErrorCode.AuthenticationFailed, result.Error!.Code);
        Assert.Empty(harness.Store.Users);
        Assert.Empty(harness.Store.Identities);
        Assert.Empty(harness.Store.RefreshTokens);
        Assert.Empty(harness.TokenService.IssuedFor);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task AssertionWithNoSubject_FailsAuthentication_AndCreatesNothing(string? subject)
    {
        var harness = Harness.For(
            GoogleSignInVerifierFake.Returning(GoogleAssertion(subject!, "x@gmail.com", emailVerified: true)));

        Result<AuthSession> result =
            await harness.Handler.HandleAsync(new SignInWithGoogleCommand("assertion"), CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Equal(AuthErrorCode.AuthenticationFailed, result.Error!.Code);
        Assert.Empty(harness.Store.Users);
        Assert.Empty(harness.Store.Identities);
    }

    [Fact]
    public async Task Session_PersistsOnlyTheRefreshTokenHash_NotThePlaintext()
    {
        var harness = Harness.For(
            GoogleSignInVerifierFake.Returning(GoogleAssertion(Subject, "p@gmail.com", emailVerified: true)));

        Result<AuthSession> result =
            await harness.Handler.HandleAsync(new SignInWithGoogleCommand("assertion"), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Single(harness.Store.RefreshTokens);
        RefreshToken stored = harness.Store.RefreshTokens[0];

        // The stored value is the one-way hash of the returned plaintext, never the plaintext itself.
        Assert.Equal(RefreshTokenStatus.Active, stored.Status);
        Assert.Equal(GoogleSignInTokenServiceFake.RefreshHashPrefix + result.Value!.RefreshToken, stored.TokenHash);
        Assert.NotEqual(result.Value.RefreshToken, stored.TokenHash);
        Assert.Equal(result.Value.RefreshTokenExpiresAt, stored.ExpiresAt);
    }

    [Fact]
    public async Task NoEmailClaim_CreatesUnverifiedUser_StillEstablishesSession()
    {
        var harness = Harness.For(
            GoogleSignInVerifierFake.Returning(GoogleAssertion(Subject, email: null, emailVerified: false)));

        Result<AuthSession> result =
            await harness.Handler.HandleAsync(new SignInWithGoogleCommand("assertion"), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Single(harness.Store.Users);
        Assert.False(harness.Store.Users[0].EmailVerified);
        Assert.Single(harness.Store.Identities);
        Assert.Equal(Subject, harness.Store.Identities[0].ProviderUserId);
    }

    [Fact]
    public async Task ConcurrentCreationRace_SurfacesAsAuthenticationFailure_AndPersistsNothing()
    {
        var harness = Harness.For(
            GoogleSignInVerifierFake.Returning(GoogleAssertion(Subject, "race@gmail.com", emailVerified: true)),
            throwOnSave: true);

        Result<AuthSession> result =
            await harness.Handler.HandleAsync(new SignInWithGoogleCommand("assertion"), CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Equal(AuthErrorCode.AuthenticationFailed, result.Error!.Code);
        Assert.Empty(harness.Store.Users);
        Assert.Empty(harness.Store.Identities);
        Assert.Empty(harness.Store.RefreshTokens);
    }
}
