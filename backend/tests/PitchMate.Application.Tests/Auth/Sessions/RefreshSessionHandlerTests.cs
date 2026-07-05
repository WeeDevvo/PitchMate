using PitchMate.Application.Auth;
using PitchMate.Application.Auth.UseCases;
using PitchMate.Domain.Auth;

namespace PitchMate.Application.Tests.Auth.Sessions;

/// <summary>
/// Example/unit tests for <see cref="RefreshSessionHandler"/> covering the four refresh
/// outcomes — valid rotation, unknown token, reuse of a superseded member, and expiry —
/// against in-memory fakes (Requirements 9.2, 9.3, 9.5, 9.9). The named-property invariants
/// (Properties 23, 24) are covered separately by tasks 11.11–11.12.
/// </summary>
[Trait("Feature", "auth-and-identity")]
public class RefreshSessionHandlerTests
{
    private static readonly TimeSpan RefreshLifetime = TimeSpan.FromDays(30);

    private sealed class Harness
    {
        public required SessionFakeClock Clock { get; init; }
        public required SessionSecretHasherFake SecretHasher { get; init; }
        public required SessionTokenServiceFake TokenService { get; init; }
        public required SessionRefreshTokenStoreFake RefreshTokens { get; init; }
        public required SessionUserRepositoryFake Users { get; init; }
        public required SessionUnitOfWorkFake UnitOfWork { get; init; }
        public required RefreshSessionHandler Handler { get; init; }
        public required Guid UserId { get; init; }

        public static Harness Create()
        {
            var clock = new SessionFakeClock();
            var secretHasher = new SessionSecretHasherFake();
            var tokenService = new SessionTokenServiceFake(clock);
            var refreshTokens = new SessionRefreshTokenStoreFake(clock);
            var users = new SessionUserRepositoryFake();
            var unitOfWork = new SessionUnitOfWorkFake();

            var user = User.Create("Pat Player", "pat@example.com");
            users.Seed(user);

            var handler = new RefreshSessionHandler(
                refreshTokens, users, tokenService, secretHasher, unitOfWork, clock);

            return new Harness
            {
                Clock = clock,
                SecretHasher = secretHasher,
                TokenService = tokenService,
                RefreshTokens = refreshTokens,
                Users = users,
                UnitOfWork = unitOfWork,
                Handler = handler,
                UserId = user.Id,
            };
        }

        /// <summary>Seeds an active family head whose hash matches <paramref name="plaintext"/>.</summary>
        public RefreshToken SeedActiveHead(string plaintext, TimeSpan? ttl = null)
        {
            DateTimeOffset expiresAt = Clock.GetUtcNow() + (ttl ?? RefreshLifetime);
            var token = RefreshToken.StartFamily(UserId, SecretHasher.Hash(plaintext), expiresAt);
            RefreshTokens.Seed(token);
            return token;
        }
    }

    [Fact]
    public async Task ValidActiveToken_RotatesAndIssuesNewSession()
    {
        var harness = Harness.Create();
        RefreshToken head = harness.SeedActiveHead("present-me");

        Result<RefreshSessionResult> result =
            await harness.Handler.HandleAsync(new RefreshSessionCommand("present-me"), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.NotNull(result.Value);
        Assert.False(string.IsNullOrEmpty(result.Value!.AccessToken));
        Assert.False(string.IsNullOrEmpty(result.Value.RefreshToken));

        // Presented token is rotated; a successor exists and is the sole active member.
        Assert.Equal(RefreshTokenStatus.Rotated, head.Status);
        var family = harness.RefreshTokens.All.Where(t => t.TokenFamilyId == head.TokenFamilyId).ToList();
        Assert.Equal(2, family.Count);
        Assert.Single(family, t => t.Status == RefreshTokenStatus.Active);

        // The successor's expiry is the clock instant plus the configured lifetime.
        RefreshToken successor = family.Single(t => t.Status == RefreshTokenStatus.Active);
        Assert.Equal(harness.Clock.GetUtcNow() + RefreshLifetime, successor.ExpiresAt);
        Assert.Equal(result.Value.RefreshTokenExpiresAt, successor.ExpiresAt);

        // The successor hash matches the returned plaintext (persist only the hash).
        Assert.Equal(harness.SecretHasher.Hash(result.Value.RefreshToken), successor.TokenHash);

        Assert.Contains(harness.UserId, harness.TokenService.IssuedFor);
        Assert.Equal(1, harness.UnitOfWork.SaveCount);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task AbsentToken_IsRejectedAsInvalid_AndChangesNothing(string? presented)
    {
        var harness = Harness.Create();

        Result<RefreshSessionResult> result =
            await harness.Handler.HandleAsync(new RefreshSessionCommand(presented), CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Equal(AuthErrorCode.TokenInvalid, result.Error!.Code);
        Assert.Equal(0, harness.UnitOfWork.SaveCount);
        Assert.Empty(harness.TokenService.IssuedFor);
    }

    [Fact]
    public async Task UnknownToken_IsRejectedAsInvalid_AndLeavesFamiliesUnchanged()
    {
        var harness = Harness.Create();
        RefreshToken head = harness.SeedActiveHead("the-real-one");

        Result<RefreshSessionResult> result =
            await harness.Handler.HandleAsync(new RefreshSessionCommand("never-issued"), CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Equal(AuthErrorCode.TokenInvalid, result.Error!.Code);
        Assert.Equal(RefreshTokenStatus.Active, head.Status);
        Assert.Single(harness.RefreshTokens.All);
        Assert.Equal(0, harness.UnitOfWork.SaveCount);
        Assert.Empty(harness.TokenService.IssuedFor);
    }

    [Fact]
    public async Task ReuseOfRotatedToken_RevokesTheWholeFamily()
    {
        var harness = Harness.Create();
        RefreshToken head = harness.SeedActiveHead("first");

        // Rotate once legitimately so the head becomes Rotated and a successor is Active.
        await harness.Handler.HandleAsync(new RefreshSessionCommand("first"), CancellationToken.None);
        Assert.Equal(RefreshTokenStatus.Rotated, head.Status);

        int savesBefore = harness.UnitOfWork.SaveCount;

        // Replay the now-rotated original: reuse detected.
        Result<RefreshSessionResult> result =
            await harness.Handler.HandleAsync(new RefreshSessionCommand("first"), CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Equal(AuthErrorCode.TokenInvalid, result.Error!.Code);

        // Every member of the family is now revoked.
        var family = harness.RefreshTokens.All.Where(t => t.TokenFamilyId == head.TokenFamilyId).ToList();
        Assert.All(family, t => Assert.Equal(RefreshTokenStatus.Revoked, t.Status));
        Assert.Equal(savesBefore + 1, harness.UnitOfWork.SaveCount);
    }

    [Fact]
    public async Task ReuseOfRevokedToken_RevokesTheWholeFamily()
    {
        var harness = Harness.Create();
        RefreshToken head = harness.SeedActiveHead("revoked-one");
        head.Revoke();

        Result<RefreshSessionResult> result =
            await harness.Handler.HandleAsync(new RefreshSessionCommand("revoked-one"), CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Equal(AuthErrorCode.TokenInvalid, result.Error!.Code);
        var family = harness.RefreshTokens.All.Where(t => t.TokenFamilyId == head.TokenFamilyId).ToList();
        Assert.All(family, t => Assert.Equal(RefreshTokenStatus.Revoked, t.Status));
        Assert.Empty(harness.TokenService.IssuedFor);
    }

    [Fact]
    public async Task ExpiredToken_IsRejectedAsExpired_AndIssuesNothing()
    {
        var harness = Harness.Create();
        RefreshToken head = harness.SeedActiveHead("stale", ttl: TimeSpan.FromMinutes(5));

        // Advance past the token's expiry; it remains Active in status but is no longer usable.
        harness.Clock.Advance(TimeSpan.FromMinutes(10));

        Result<RefreshSessionResult> result =
            await harness.Handler.HandleAsync(new RefreshSessionCommand("stale"), CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Equal(AuthErrorCode.TokenExpired, result.Error!.Code);
        Assert.Equal(RefreshTokenStatus.Active, head.Status);
        Assert.Single(harness.RefreshTokens.All);
        Assert.Equal(0, harness.UnitOfWork.SaveCount);
        Assert.Empty(harness.TokenService.IssuedFor);
    }
}
