using PitchMate.Application.Auth;
using PitchMate.Application.Auth.Abstractions;
using PitchMate.Application.Common.Persistence;
using PitchMate.Domain.Auth;

namespace PitchMate.Application.Tests.Auth.PasswordReset;

// Hand-written, in-memory test doubles shared by the password-reset property tests
// (Properties 26-29). These are real fakes — dictionaries and lists, never a database and
// never a mocking-framework stub — so the password-reset use cases can be exercised as pure
// Application unit tests. Every type here is prefixed "PasswordReset" and lives in the
// Auth/PasswordReset folder so it never collides with fakes authored by sibling test tasks.

/// <summary>
/// A controllable <see cref="TimeProvider"/> anchored at a fixed instant, so token
/// expiry and rate-limit windows are deterministic across property iterations. Stands in
/// for a FakeTimeProvider for the password-reset clock-dependent behaviour.
/// </summary>
internal sealed class PasswordResetFakeClock(DateTimeOffset utcNow) : TimeProvider
{
    private DateTimeOffset _utcNow = utcNow.ToUniversalTime();

    /// <summary>A stable default instant used when a test does not care about the exact clock value.</summary>
    public static DateTimeOffset DefaultNow { get; } =
        new(2025, 1, 1, 12, 0, 0, TimeSpan.Zero);

    public PasswordResetFakeClock() : this(DefaultNow)
    {
    }

    public override DateTimeOffset GetUtcNow() => _utcNow;

    /// <summary>Advances the reported instant by <paramref name="delta"/>.</summary>
    public void Advance(TimeSpan delta) => _utcNow = _utcNow.Add(delta);
}

/// <summary>
/// Deterministic <see cref="IPasswordHasher"/> fake. The "hash" is a reversible-looking
/// but opaque transform of the plaintext; <see cref="Verify"/> re-hashes and compares, so
/// a stored hash verifies against exactly the plaintext that produced it.
/// </summary>
internal sealed class PasswordResetPasswordHasherFake : IPasswordHasher
{
    private const string Prefix = "pwhash::";

    public string Hash(string plaintext) => Prefix + plaintext;

    public PasswordVerification Verify(string? storedHash, string plaintext)
    {
        if (string.IsNullOrEmpty(storedHash) || !storedHash.StartsWith(Prefix, StringComparison.Ordinal))
        {
            return PasswordVerification.Failure;
        }

        return storedHash == Hash(plaintext)
            ? PasswordVerification.Success
            : PasswordVerification.Failure;
    }
}

/// <summary>
/// Deterministic <see cref="ISecretHasher"/> fake: a stable one-way-looking transform so a
/// presented secret hashes to the same value that was stored at issuance.
/// </summary>
internal sealed class PasswordResetSecretHasherFake : ISecretHasher
{
    private const string Prefix = "sechash::";

    public string Hash(string secret) => Prefix + secret;

    public bool Verify(string secret, string storedHash) => Hash(secret) == storedHash;
}

/// <summary>
/// A <see cref="ISecretTokenGenerator"/> fake that yields a fresh, unique opaque secret on
/// each call.
/// </summary>
internal sealed class PasswordResetSecretTokenGeneratorFake : ISecretTokenGenerator
{
    public string Generate() => "reset-secret-" + Guid.NewGuid().ToString("N");
}

/// <summary>
/// An <see cref="IEmailSender"/> fake that records every message it is asked to deliver
/// and reports success, so a test can assert whether (and what) email was sent.
/// </summary>
internal sealed class PasswordResetEmailSenderFake : IEmailSender
{
    public List<EmailMessage> Sent { get; } = [];

    public Task<Result> SendAsync(EmailMessage message, CancellationToken cancellationToken)
    {
        Sent.Add(message);
        return Task.FromResult(Result.Ok());
    }
}

/// <summary>
/// An <see cref="IUnitOfWork"/> fake that counts commits, so a test can confirm whether
/// state was persisted (a rejected redemption must not commit).
/// </summary>
internal sealed class PasswordResetUnitOfWorkFake : IUnitOfWork
{
    public int SaveCount { get; private set; }

    public Task<int> SaveChangesAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        SaveCount++;
        return Task.FromResult(0);
    }
}

/// <summary>
/// In-memory <see cref="IRepository{T}"/> for <see cref="AuthIdentity"/> exposing only the
/// lookup the redeem handler needs (<see cref="GetByIdAsync"/>). Other members are present
/// to satisfy the interface and are not exercised by the password-reset use cases.
/// </summary>
internal sealed class PasswordResetAuthIdentityByIdFake : IRepository<AuthIdentity>
{
    private readonly Dictionary<Guid, AuthIdentity> _byId = new();

    public void Seed(AuthIdentity identity) => _byId[identity.Id] = identity;

    public Task<AuthIdentity?> GetByIdAsync(Guid id, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        _byId.TryGetValue(id, out AuthIdentity? identity);
        return Task.FromResult(identity);
    }

    public Task AddAsync(AuthIdentity entity, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        _byId[entity.Id] = entity;
        return Task.CompletedTask;
    }

    public Task<IReadOnlyList<AuthIdentity>> ListAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        IReadOnlyList<AuthIdentity> all = _byId.Values.ToList();
        return Task.FromResult(all);
    }

    public Task<IReadOnlyList<AuthIdentity>> ListChronologicalAsync(bool includeDeleted, CancellationToken cancellationToken)
        => ListAsync(cancellationToken);

    public void Remove(AuthIdentity entity) => _byId.Remove(entity.Id);

    public void Restore(AuthIdentity entity)
    {
        // No soft-delete modelling needed for the password-reset use cases.
    }
}

/// <summary>
/// In-memory <see cref="IAuthIdentityRepository"/>. Resolution is solely on the provider
/// key pair, mirroring the production contract, and <see cref="ListForUserAsync"/> returns
/// identities with their eager-loaded credentials.
/// </summary>
internal sealed class PasswordResetAuthIdentityRepositoryFake : IAuthIdentityRepository
{
    private readonly List<AuthIdentity> _identities = [];

    public void Seed(AuthIdentity identity) => _identities.Add(identity);

    public Task<AuthIdentity?> FindByProviderKeyAsync(
        AuthProvider provider, string providerUserId, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        AuthIdentity? match = _identities.FirstOrDefault(
            i => i.Provider == provider && i.ProviderUserId == providerUserId);
        return Task.FromResult(match);
    }

    public Task<IReadOnlyList<AuthIdentity>> ListForUserAsync(Guid userId, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        IReadOnlyList<AuthIdentity> owned = _identities.Where(i => i.UserId == userId).ToList();
        return Task.FromResult(owned);
    }

    public Task AddAsync(AuthIdentity identity, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        _identities.Add(identity);
        return Task.CompletedTask;
    }

    public void Remove(AuthIdentity identity) => _identities.Remove(identity);
}

/// <summary>
/// In-memory <see cref="IPasswordResetTokenRepository"/>. Redeemability is judged against
/// the injected clock so it matches the production semantics, and request counting backs
/// the rolling-window rate limit.
/// </summary>
internal sealed class PasswordResetTokenRepositoryFake(TimeProvider clock) : IPasswordResetTokenRepository
{
    private readonly List<PasswordResetToken> _tokens = [];

    public IReadOnlyList<PasswordResetToken> All => _tokens;

    public void Seed(PasswordResetToken token) => _tokens.Add(token);

    public Task AddAsync(PasswordResetToken token, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        _tokens.Add(token);
        return Task.CompletedTask;
    }

    public Task<PasswordResetToken?> FindRedeemableByHashAsync(string tokenHash, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        DateTimeOffset now = clock.GetUtcNow();
        PasswordResetToken? match = _tokens.FirstOrDefault(
            t => t.TokenHash == tokenHash && t.IsRedeemableAt(now));
        return Task.FromResult(match);
    }

    public Task<IReadOnlyList<PasswordResetToken>> ListUnredeemedForAuthIdentityAsync(
        Guid authIdentityId, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        IReadOnlyList<PasswordResetToken> unredeemed = _tokens
            .Where(t => t.AuthIdentityId == authIdentityId && t.RedeemedAt is null)
            .ToList();
        return Task.FromResult(unredeemed);
    }

    public Task<int> CountRequestsInWindowAsync(Guid authIdentityId, DateTimeOffset since, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        int count = _tokens.Count(t => t.AuthIdentityId == authIdentityId && t.CreatedAt >= since);
        return Task.FromResult(count);
    }
}

/// <summary>
/// In-memory <see cref="IRefreshTokenStore"/>. <see cref="ListActiveForUserAsync"/> returns
/// the user's currently active (unexpired, <see cref="RefreshTokenStatus.Active"/>) tokens,
/// judged against the injected clock — the set a password reset must revoke.
/// </summary>
internal sealed class PasswordResetRefreshTokenStoreFake(TimeProvider clock) : IRefreshTokenStore
{
    private readonly List<RefreshToken> _tokens = [];

    public IReadOnlyList<RefreshToken> All => _tokens;

    public void Seed(RefreshToken token) => _tokens.Add(token);

    public Task AddAsync(RefreshToken token, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        _tokens.Add(token);
        return Task.CompletedTask;
    }

    public Task<RefreshToken?> FindByHashAsync(string tokenHash, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        RefreshToken? match = _tokens.FirstOrDefault(t => t.TokenHash == tokenHash);
        return Task.FromResult(match);
    }

    public Task<IReadOnlyList<RefreshToken>> ListFamilyAsync(Guid tokenFamilyId, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        IReadOnlyList<RefreshToken> family = _tokens.Where(t => t.TokenFamilyId == tokenFamilyId).ToList();
        return Task.FromResult(family);
    }

    public Task<IReadOnlyList<RefreshToken>> ListActiveForUserAsync(Guid userId, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        DateTimeOffset now = clock.GetUtcNow();
        IReadOnlyList<RefreshToken> active = _tokens
            .Where(t => t.UserId == userId && t.IsActiveAt(now))
            .ToList();
        return Task.FromResult(active);
    }
}
