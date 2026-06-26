using PitchMate.Application.Auth.PasswordReset;
using PitchMate.Domain.Auth;

namespace PitchMate.Application.Tests.Auth.PasswordReset;

/// <summary>
/// Builds a fully wired <see cref="RedeemPasswordResetHandler"/> over in-memory fakes for the
/// reset-redemption property tests (Properties 26-28). A single Password identity owns a
/// credential and a redeemable reset token; a configurable number of the user's own active
/// refresh tokens (and some belonging to an unrelated user) let a test observe revocation
/// scope. Everything is anchored to a controllable clock so token redeemability is deterministic.
/// </summary>
internal sealed class PasswordResetRedeemHarness
{
    public required PasswordResetFakeClock Clock { get; init; }
    public required PasswordResetSecretHasherFake SecretHasher { get; init; }
    public required PasswordResetPasswordHasherFake PasswordHasher { get; init; }
    public required PasswordResetTokenRepositoryFake ResetTokens { get; init; }
    public required PasswordResetRefreshTokenStoreFake RefreshTokens { get; init; }
    public required PasswordResetUnitOfWorkFake UnitOfWork { get; init; }
    public required RedeemPasswordResetHandler Handler { get; init; }

    public required Guid UserId { get; init; }
    public required AuthIdentity Identity { get; init; }
    public required PasswordCredential Credential { get; init; }
    public required PasswordResetToken Token { get; init; }
    public required string OriginalHash { get; init; }
    public required IReadOnlyList<RefreshToken> UserRefreshTokens { get; init; }
    public required IReadOnlyList<RefreshToken> OtherUserRefreshTokens { get; init; }

    public static PasswordResetRedeemHarness Create(
        string oldPasswordPlaintext,
        string tokenSecret,
        TimeSpan tokenLifetime,
        int activeRefreshTokenCount,
        int otherUserRefreshTokenCount)
    {
        var clock = new PasswordResetFakeClock();
        DateTimeOffset now = clock.GetUtcNow();

        var secretHasher = new PasswordResetSecretHasherFake();
        var passwordHasher = new PasswordResetPasswordHasherFake();

        Guid userId = Guid.CreateVersion7();
        string originalHash = passwordHasher.Hash(oldPasswordPlaintext);
        var credential = PasswordCredential.Create(originalHash);
        var identity = AuthIdentity.ForPassword(userId, "owner@example.com", credential);

        var authIdentities = new PasswordResetAuthIdentityRepositoryFake();
        authIdentities.Seed(identity);

        var authIdentityById = new PasswordResetAuthIdentityByIdFake();
        authIdentityById.Seed(identity);

        var resetTokens = new PasswordResetTokenRepositoryFake(clock);
        var token = PasswordResetToken.Issue(
            identity.Id, secretHasher.Hash(tokenSecret), now + tokenLifetime);
        resetTokens.Seed(token);

        var refreshTokens = new PasswordResetRefreshTokenStoreFake(clock);

        var userTokens = new List<RefreshToken>();
        for (int i = 0; i < activeRefreshTokenCount; i++)
        {
            var rt = RefreshToken.StartFamily(
                userId, $"user-rt-{Guid.NewGuid():N}", now + TimeSpan.FromDays(7));
            userTokens.Add(rt);
            refreshTokens.Seed(rt);
        }

        var otherUserId = Guid.CreateVersion7();
        var otherTokens = new List<RefreshToken>();
        for (int i = 0; i < otherUserRefreshTokenCount; i++)
        {
            var rt = RefreshToken.StartFamily(
                otherUserId, $"other-rt-{Guid.NewGuid():N}", now + TimeSpan.FromDays(7));
            otherTokens.Add(rt);
            refreshTokens.Seed(rt);
        }

        var unitOfWork = new PasswordResetUnitOfWorkFake();

        var handler = new RedeemPasswordResetHandler(
            resetTokens,
            authIdentities,
            authIdentityById,
            refreshTokens,
            passwordHasher,
            secretHasher,
            unitOfWork,
            clock);

        return new PasswordResetRedeemHarness
        {
            Clock = clock,
            SecretHasher = secretHasher,
            PasswordHasher = passwordHasher,
            ResetTokens = resetTokens,
            RefreshTokens = refreshTokens,
            UnitOfWork = unitOfWork,
            Handler = handler,
            UserId = userId,
            Identity = identity,
            Credential = credential,
            Token = token,
            OriginalHash = originalHash,
            UserRefreshTokens = userTokens,
            OtherUserRefreshTokens = otherTokens,
        };
    }
}
