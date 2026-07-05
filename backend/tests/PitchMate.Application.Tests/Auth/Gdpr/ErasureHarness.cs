using PitchMate.Application.Auth.Gdpr;
using PitchMate.Domain.Auth;

namespace PitchMate.Application.Tests.Auth.Gdpr;

/// <summary>
/// A controllable <see cref="TimeProvider"/> anchored at a fixed instant, so refresh-token
/// activity is deterministic across property iterations.
/// </summary>
internal sealed class ErasureFakeClock(DateTimeOffset utcNow) : TimeProvider
{
    private readonly DateTimeOffset _utcNow = utcNow.ToUniversalTime();

    public static DateTimeOffset DefaultNow { get; } = new(2025, 1, 1, 12, 0, 0, TimeSpan.Zero);

    public ErasureFakeClock() : this(DefaultNow)
    {
    }

    public override DateTimeOffset GetUtcNow() => _utcNow;
}

/// <summary>
/// Describes one external identity the target user owns: the provider and the original
/// subject it resolved on before erasure scrubbed it.
/// </summary>
internal readonly record struct ExternalIdentitySpec(AuthProvider Provider, string OriginalProviderUserId);

/// <summary>
/// Builds a fully wired <see cref="EraseUserHandler"/> over in-memory fakes for the erasure
/// property tests. The target user owns an arbitrary mix of an optional Password identity
/// (with its credential) and external identities, plus a configurable number of active
/// refresh tokens. A second, unrelated user with its own external identity and active token
/// is seeded so the test can confirm erasure touches only the target.
/// </summary>
internal sealed class ErasureHarness
{
    public required EraseUserHandler Handler { get; init; }
    public required ErasureAuthIdentityRepositoryFake AuthIdentities { get; init; }
    public required ErasurePasswordCredentialRepositoryFake PasswordCredentials { get; init; }
    public required ErasureRefreshTokenStoreFake RefreshTokens { get; init; }
    public required ErasureUnitOfWorkFake UnitOfWork { get; init; }

    public required Guid UserId { get; init; }

    /// <summary>The original (Provider, ProviderUserId) pairs of the target user's external identities.</summary>
    public required IReadOnlyList<ExternalIdentitySpec> ExternalIdentities { get; init; }

    /// <summary>The credential ids the target user's Password identities owned at seed time.</summary>
    public required IReadOnlyList<Guid> SeededCredentialIds { get; init; }

    /// <summary>The target user's refresh tokens (all active at seed time).</summary>
    public required IReadOnlyList<RefreshToken> UserRefreshTokens { get; init; }

    /// <summary>The unrelated user's untouched external identity and its original subject.</summary>
    public required AuthIdentity OtherUserIdentity { get; init; }
    public required string OtherUserOriginalProviderUserId { get; init; }
    public required RefreshToken OtherUserRefreshToken { get; init; }

    public static ErasureHarness Create(
        bool hasPassword,
        IReadOnlyList<AuthProvider> externalProviders,
        int activeRefreshTokenCount)
    {
        var clock = new ErasureFakeClock();
        DateTimeOffset now = clock.GetUtcNow();
        DateTimeOffset expiry = now + TimeSpan.FromDays(7);

        var users = new ErasureUserRepositoryFake();
        var authIdentities = new ErasureAuthIdentityRepositoryFake();
        var credentials = new ErasurePasswordCredentialRepositoryFake();
        var refreshTokens = new ErasureRefreshTokenStoreFake(clock);
        var unitOfWork = new ErasureUnitOfWorkFake();

        var user = User.Create("Target Player", "target@example.com");
        users.Seed(user);
        Guid userId = user.Id;

        var seededCredentialIds = new List<Guid>();

        if (hasPassword)
        {
            var credential = PasswordCredential.Create("pwhash::target");
            var passwordIdentity = AuthIdentity.ForPassword(userId, "target@example.com", credential);
            authIdentities.Seed(passwordIdentity);
            credentials.Seed(credential);
            seededCredentialIds.Add(credential.Id);
        }

        var externalSpecs = new List<ExternalIdentitySpec>();
        int index = 0;
        foreach (AuthProvider provider in externalProviders)
        {
            string subject = $"{provider}-subject-{index}-{Guid.NewGuid():N}";
            var external = AuthIdentity.ForExternal(userId, provider, subject);
            authIdentities.Seed(external);
            externalSpecs.Add(new ExternalIdentitySpec(provider, subject));
            index++;
        }

        var userTokens = new List<RefreshToken>();
        for (int i = 0; i < activeRefreshTokenCount; i++)
        {
            var rt = RefreshToken.StartFamily(userId, $"user-rt-{Guid.NewGuid():N}", expiry);
            userTokens.Add(rt);
            refreshTokens.Seed(rt);
        }

        // A second, unrelated user whose identity and session must remain intact.
        var otherUser = User.Create("Other Player", "other@example.com");
        users.Seed(otherUser);
        string otherSubject = $"other-subject-{Guid.NewGuid():N}";
        var otherIdentity = AuthIdentity.ForExternal(otherUser.Id, AuthProvider.Google, otherSubject);
        authIdentities.Seed(otherIdentity);
        var otherToken = RefreshToken.StartFamily(otherUser.Id, $"other-rt-{Guid.NewGuid():N}", expiry);
        refreshTokens.Seed(otherToken);

        var handler = new EraseUserHandler(users, authIdentities, credentials, refreshTokens, unitOfWork);

        return new ErasureHarness
        {
            Handler = handler,
            AuthIdentities = authIdentities,
            PasswordCredentials = credentials,
            RefreshTokens = refreshTokens,
            UnitOfWork = unitOfWork,
            UserId = userId,
            ExternalIdentities = externalSpecs,
            SeededCredentialIds = seededCredentialIds,
            UserRefreshTokens = userTokens,
            OtherUserIdentity = otherIdentity,
            OtherUserOriginalProviderUserId = otherSubject,
            OtherUserRefreshToken = otherToken,
        };
    }
}
