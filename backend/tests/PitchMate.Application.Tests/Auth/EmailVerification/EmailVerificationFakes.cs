using PitchMate.Application.Auth;
using PitchMate.Application.Auth.Abstractions;
using PitchMate.Application.Common.Persistence;
using PitchMate.Domain.Auth;

namespace PitchMate.Application.Tests.Auth.EmailVerification;

/// <summary>
/// A hand-rolled, controllable <see cref="TimeProvider"/> for the email-verification
/// property tests: <see cref="GetUtcNow"/> returns a fixed instant that the test can move
/// forward with <see cref="Advance"/> or set with <see cref="SetUtcNow"/>. Used in place of
/// a framework fake so clock-dependent token expiry/redeemability can be exercised
/// deterministically without a real wall clock.
/// </summary>
internal sealed class EmailVerificationFakeTimeProvider : TimeProvider
{
    private DateTimeOffset _utcNow;

    public EmailVerificationFakeTimeProvider(DateTimeOffset start) => _utcNow = start;

    public override DateTimeOffset GetUtcNow() => _utcNow;

    public void SetUtcNow(DateTimeOffset value) => _utcNow = value;

    public void Advance(TimeSpan delta) => _utcNow += delta;
}

/// <summary>
/// In-memory fake <see cref="IEmailVerificationTokenRepository"/> backed by a list. It models
/// the real contract faithfully: <see cref="AddAsync"/> stages a token,
/// <see cref="FindRedeemableByHashAsync"/> returns the single currently redeemable
/// (unredeemed and unexpired) token by hash using the shared clock, and
/// <see cref="ListUnredeemedForUserAsync"/> returns a user's unredeemed tokens so a re-issue
/// can supersede them.
/// </summary>
internal sealed class EmailVerificationFakeTokenRepository : IEmailVerificationTokenRepository
{
    private readonly List<EmailVerificationToken> _tokens = new();
    private readonly TimeProvider _clock;

    public EmailVerificationFakeTokenRepository(TimeProvider clock) => _clock = clock;

    /// <summary>All tokens ever added, regardless of state — for test assertions.</summary>
    public IReadOnlyList<EmailVerificationToken> All => _tokens;

    /// <summary>The count of tokens redeemable for <paramref name="userId"/> at the current clock instant.</summary>
    public int RedeemableCountFor(Guid userId)
    {
        DateTimeOffset now = _clock.GetUtcNow();
        return _tokens.Count(t => t.UserId == userId && t.IsRedeemableAt(now));
    }

    public Task AddAsync(EmailVerificationToken token, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        ArgumentNullException.ThrowIfNull(token);
        _tokens.Add(token);
        return Task.CompletedTask;
    }

    public Task<EmailVerificationToken?> FindRedeemableByHashAsync(string tokenHash, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        DateTimeOffset now = _clock.GetUtcNow();
        EmailVerificationToken? match = _tokens
            .FirstOrDefault(t => t.TokenHash == tokenHash && t.IsRedeemableAt(now));
        return Task.FromResult(match);
    }

    public Task<IReadOnlyList<EmailVerificationToken>> ListUnredeemedForUserAsync(Guid userId, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        IReadOnlyList<EmailVerificationToken> result = _tokens
            .Where(t => t.UserId == userId && t.RedeemedAt is null)
            .ToList();
        return Task.FromResult(result);
    }
}

/// <summary>
/// In-memory fake <see cref="IUserRepository"/> backed by a dictionary keyed on
/// <see cref="PitchMate.Domain.Common.BaseEntity.Id"/>.
/// </summary>
internal sealed class EmailVerificationFakeUserRepository : IUserRepository
{
    private readonly Dictionary<Guid, User> _users = new();

    public Task AddAsync(User user, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        ArgumentNullException.ThrowIfNull(user);
        _users[user.Id] = user;
        return Task.CompletedTask;
    }

    /// <summary>Adds <paramref name="user"/> directly to the store for test arrangement.</summary>
    public void Seed(User user) => _users[user.Id] = user;

    public Task<User?> GetByIdAsync(Guid id, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        _users.TryGetValue(id, out User? user);
        return Task.FromResult(user);
    }
}

/// <summary>
/// A deterministic, injective <see cref="ISecretHasher"/> fake: the "hash" is the secret with
/// a fixed prefix, so distinct secrets always hash distinctly and a presented secret matches
/// its stored hash. No cryptography is involved — these are pure Application unit tests.
/// </summary>
internal sealed class EmailVerificationFakeSecretHasher : ISecretHasher
{
    private const string Prefix = "ev-hash:";

    public string Hash(string secret) => Prefix + secret;

    public bool Verify(string secret, string storedHash) => storedHash == Prefix + secret;
}

/// <summary>
/// An <see cref="ISecretTokenGenerator"/> fake that produces a fresh, unique secret on every
/// call and records the most recent one so a test can redeem it. Uniqueness guarantees
/// distinct token hashes across re-issues.
/// </summary>
internal sealed class EmailVerificationFakeTokenGenerator : ISecretTokenGenerator
{
    private int _counter;

    /// <summary>The most recently generated secret, or <see langword="null"/> before any call.</summary>
    public string? LastSecret { get; private set; }

    public string Generate()
    {
        string secret = $"secret-{_counter++}-{Guid.NewGuid():N}";
        LastSecret = secret;
        return secret;
    }
}

/// <summary>
/// An <see cref="IEmailSender"/> fake whose delivery outcome is configurable. By default it
/// accepts every message and records it; set <see cref="ShouldSucceed"/> to <see langword="false"/>
/// to simulate a delivery failure.
/// </summary>
internal sealed class EmailVerificationFakeEmailSender : IEmailSender
{
    private readonly List<EmailMessage> _sent = new();

    /// <summary>Whether <see cref="SendAsync"/> reports success; defaults to <see langword="true"/>.</summary>
    public bool ShouldSucceed { get; set; } = true;

    /// <summary>Every message that was accepted for delivery.</summary>
    public IReadOnlyList<EmailMessage> Sent => _sent;

    public Task<Result> SendAsync(EmailMessage message, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        ArgumentNullException.ThrowIfNull(message);

        if (!ShouldSucceed)
        {
            return Task.FromResult(Result.Fail(new AuthError(
                AuthErrorCode.DeliveryFailed,
                "Simulated delivery failure.")));
        }

        _sent.Add(message);
        return Task.FromResult(Result.Ok());
    }
}

/// <summary>
/// An in-memory fake <see cref="IUnitOfWork"/> that honours cancellation and counts commits,
/// so tests can confirm that work was (or was not) committed.
/// </summary>
internal sealed class EmailVerificationFakeUnitOfWork : IUnitOfWork
{
    /// <summary>The number of times <see cref="SaveChangesAsync"/> has been invoked.</summary>
    public int SaveCount { get; private set; }

    public Task<int> SaveChangesAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        SaveCount++;
        return Task.FromResult(0);
    }
}
