using PitchMate.Application.Auth.Abstractions;
using PitchMate.Application.Common.Persistence;
using PitchMate.Domain.Auth;

namespace PitchMate.Application.Tests.Auth.Sessions;

// Hand-written, in-memory test doubles for the refresh-session and sign-out use cases
// (task 11.10). These are real fakes — dictionaries and lists, never a database and never a
// mocking-framework stub — so the handlers can be exercised as pure Application unit tests.
// Every type here is prefixed "Session" and lives in the Auth/Sessions folder so it never
// collides with fakes authored by sibling test tasks.

/// <summary>
/// A controllable <see cref="TimeProvider"/> anchored at a fixed instant, so refresh-token
/// expiry is deterministic. Stands in for a FakeTimeProvider.
/// </summary>
internal sealed class SessionFakeClock(DateTimeOffset utcNow) : TimeProvider
{
    private DateTimeOffset _utcNow = utcNow.ToUniversalTime();

    /// <summary>A stable default instant used when a test does not care about the exact clock value.</summary>
    public static DateTimeOffset DefaultNow { get; } = new(2025, 1, 1, 12, 0, 0, TimeSpan.Zero);

    public SessionFakeClock() : this(DefaultNow)
    {
    }

    public override DateTimeOffset GetUtcNow() => _utcNow;

    /// <summary>Advances the reported instant by <paramref name="delta"/>.</summary>
    public void Advance(TimeSpan delta) => _utcNow = _utcNow.Add(delta);
}

/// <summary>
/// Deterministic <see cref="ISecretHasher"/> fake: a stable one-way-looking transform so a
/// presented secret hashes to the same value stored at issuance.
/// </summary>
internal sealed class SessionSecretHasherFake : ISecretHasher
{
    private const string Prefix = "sechash::";

    public string Hash(string secret) => Prefix + secret;

    public bool Verify(string secret, string storedHash) => Hash(secret) == storedHash;
}

/// <summary>
/// An <see cref="ITokenService"/> fake. <see cref="IssueAccessToken"/> mints a unique signed-looking
/// string with a fixed lifetime; <see cref="GenerateRefreshToken"/> yields a fresh secret each call
/// whose hash matches what <see cref="SessionSecretHasherFake"/> would produce, so a successor token
/// can be looked up by re-hashing its returned plaintext.
/// </summary>
internal sealed class SessionTokenServiceFake(TimeProvider clock) : ITokenService
{
    private const string SecretHashPrefix = "sechash::";

    public TimeSpan AccessTokenLifetime { get; init; } = TimeSpan.FromMinutes(15);

    public TimeSpan RefreshTokenLifetime { get; init; } = TimeSpan.FromDays(30);

    public List<Guid> IssuedFor { get; } = [];

    public AccessTokenResult IssueAccessToken(User user)
    {
        IssuedFor.Add(user.Id);
        DateTimeOffset expiresAt = clock.GetUtcNow() + AccessTokenLifetime;
        return new AccessTokenResult($"access-{user.Id:N}-{Guid.NewGuid():N}", expiresAt);
    }

    public AccessTokenValidation ValidateAccessToken(string? token) =>
        throw new NotSupportedException("Validation is not exercised by the session use cases.");

    public RefreshTokenSecret GenerateRefreshToken()
    {
        string plaintext = "refresh-" + Guid.NewGuid().ToString("N");
        DateTimeOffset expiresAt = clock.GetUtcNow() + RefreshTokenLifetime;
        return new RefreshTokenSecret(plaintext, SecretHashPrefix + plaintext, expiresAt);
    }
}

/// <summary>
/// In-memory <see cref="IUserRepository"/> exposing the lookup the refresh handler needs.
/// </summary>
internal sealed class SessionUserRepositoryFake : IUserRepository
{
    private readonly Dictionary<Guid, User> _byId = new();

    public void Seed(User user) => _byId[user.Id] = user;

    public Task<User?> GetByIdAsync(Guid id, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        _byId.TryGetValue(id, out User? user);
        return Task.FromResult(user);
    }

    public Task AddAsync(User user, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        _byId[user.Id] = user;
        return Task.CompletedTask;
    }
}

/// <summary>
/// An <see cref="IUnitOfWork"/> fake that counts commits, so a test can confirm whether
/// state was persisted.
/// </summary>
internal sealed class SessionUnitOfWorkFake : IUnitOfWork
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
/// In-memory <see cref="IRefreshTokenStore"/> backing the session use cases. Lookup, family
/// enumeration, and active-for-user enumeration mirror the production contract.
/// </summary>
internal sealed class SessionRefreshTokenStoreFake(TimeProvider clock) : IRefreshTokenStore
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
