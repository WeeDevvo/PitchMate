using PitchMate.Application.Auth;
using PitchMate.Application.Auth.UseCases;
using PitchMate.Domain.Auth;

namespace PitchMate.Application.Tests.Auth.Sessions;

/// <summary>
/// Example/unit tests for <see cref="SignOutHandler"/>: signing out revokes every member of
/// the presented session's token family, and is an idempotent no-op for an absent or unknown
/// token (Requirement 9.4). The named-property invariant (Property 25) is covered separately
/// by task 11.13.
/// </summary>
[Trait("Feature", "auth-and-identity")]
public class SignOutHandlerTests
{
    private sealed class Harness
    {
        public required SessionSecretHasherFake SecretHasher { get; init; }
        public required SessionRefreshTokenStoreFake RefreshTokens { get; init; }
        public required SessionUnitOfWorkFake UnitOfWork { get; init; }
        public required SignOutHandler Handler { get; init; }
        public required Guid UserId { get; init; }

        public static Harness Create()
        {
            var clock = new SessionFakeClock();
            var secretHasher = new SessionSecretHasherFake();
            var refreshTokens = new SessionRefreshTokenStoreFake(clock);
            var unitOfWork = new SessionUnitOfWorkFake();

            var handler = new SignOutHandler(refreshTokens, secretHasher, unitOfWork);

            return new Harness
            {
                SecretHasher = secretHasher,
                RefreshTokens = refreshTokens,
                UnitOfWork = unitOfWork,
                Handler = handler,
                UserId = Guid.CreateVersion7(),
            };
        }
    }

    [Fact]
    public async Task SignOut_RevokesEveryTokenInTheFamily()
    {
        var harness = Harness.Create();

        // Seed a 3-member family: head (active) -> rotated -> rotated, with one active tail.
        DateTimeOffset expiresAt = SessionFakeClock.DefaultNow + TimeSpan.FromDays(30);
        string presentPlaintext = "present-me";
        var head = RefreshToken.StartFamily(harness.UserId, harness.SecretHasher.Hash("head"), expiresAt);
        RefreshToken mid = head.Rotate(harness.SecretHasher.Hash("mid"), expiresAt);
        RefreshToken tail = mid.Rotate(harness.SecretHasher.Hash(presentPlaintext), expiresAt);
        harness.RefreshTokens.Seed(head);
        harness.RefreshTokens.Seed(mid);
        harness.RefreshTokens.Seed(tail);

        Result result =
            await harness.Handler.HandleAsync(new SignOutCommand(presentPlaintext), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.All(harness.RefreshTokens.All, t => Assert.Equal(RefreshTokenStatus.Revoked, t.Status));
        Assert.Equal(1, harness.UnitOfWork.SaveCount);
    }

    [Fact]
    public async Task SignOut_PresentingAnAlreadyRotatedMember_StillRevokesTheWholeFamily()
    {
        var harness = Harness.Create();
        DateTimeOffset expiresAt = SessionFakeClock.DefaultNow + TimeSpan.FromDays(30);
        var head = RefreshToken.StartFamily(harness.UserId, harness.SecretHasher.Hash("head"), expiresAt);
        RefreshToken tail = head.Rotate(harness.SecretHasher.Hash("tail"), expiresAt);
        harness.RefreshTokens.Seed(head);
        harness.RefreshTokens.Seed(tail);

        // Present the rotated head (not the active tail): sign-out still revokes the family.
        Result result =
            await harness.Handler.HandleAsync(new SignOutCommand("head"), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.All(harness.RefreshTokens.All, t => Assert.Equal(RefreshTokenStatus.Revoked, t.Status));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task SignOut_WithAbsentToken_IsSuccessfulNoOp(string? presented)
    {
        var harness = Harness.Create();

        Result result =
            await harness.Handler.HandleAsync(new SignOutCommand(presented), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(0, harness.UnitOfWork.SaveCount);
    }

    [Fact]
    public async Task SignOut_WithUnknownToken_IsSuccessfulNoOp()
    {
        var harness = Harness.Create();
        DateTimeOffset expiresAt = SessionFakeClock.DefaultNow + TimeSpan.FromDays(30);
        var head = RefreshToken.StartFamily(harness.UserId, harness.SecretHasher.Hash("real"), expiresAt);
        harness.RefreshTokens.Seed(head);

        Result result =
            await harness.Handler.HandleAsync(new SignOutCommand("never-issued"), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(RefreshTokenStatus.Active, head.Status);
        Assert.Equal(0, harness.UnitOfWork.SaveCount);
    }
}
