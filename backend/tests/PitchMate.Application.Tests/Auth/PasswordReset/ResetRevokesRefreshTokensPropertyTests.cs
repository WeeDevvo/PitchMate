using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Application.Auth.PasswordReset;
using PitchMate.Domain.Auth;

namespace PitchMate.Application.Tests.Auth.PasswordReset;

/// <summary>
/// Property 27: A successful password reset revokes all of the user's refresh tokens.
/// <para>
/// For any number of active refresh tokens belonging to the user whose password is reset,
/// every one of them is revoked once the reset succeeds — leaving no active refresh token
/// for that user — while refresh tokens belonging to other users are untouched. Exercised
/// over in-memory fakes as a pure Application unit test, at least 100 iterations.
/// </para>
/// </summary>
[Trait("Feature", "auth-and-identity")]
public class ResetRevokesRefreshTokensPropertyTests
{
    private static readonly TimeSpan TokenLifetime = TimeSpan.FromMinutes(30);

    // Feature: auth-and-identity, Property 27: Successful password reset revokes all of the
    // user's refresh tokens. Validates: Requirements 5.4
    [Property(MaxTest = 100)]
    [Trait("Property", "27")]
    public Property SuccessfulReset_RevokesAllUserRefreshTokens_LeavingOthersIntact() =>
        Prop.ForAll(Arb.From(ScenarioGen()), scenario =>
        {
            var (activeCount, otherCount, tokenSecret, newPassword) = scenario;

            var harness = PasswordResetRedeemHarness.Create(
                "OriginalPassword!", tokenSecret, TokenLifetime,
                activeRefreshTokenCount: activeCount, otherUserRefreshTokenCount: otherCount);

            var result = harness.Handler
                .HandleAsync(new RedeemPasswordResetCommand(tokenSecret, newPassword), CancellationToken.None)
                .GetAwaiter()
                .GetResult();

            var remainingActive = harness.RefreshTokens
                .ListActiveForUserAsync(harness.UserId, CancellationToken.None)
                .GetAwaiter()
                .GetResult();

            bool allUserTokensRevoked =
                harness.UserRefreshTokens.All(t => t.Status == RefreshTokenStatus.Revoked);
            bool otherTokensUntouched =
                harness.OtherUserRefreshTokens.All(t => t.Status == RefreshTokenStatus.Active);

            return result.IsSuccess
                && allUserTokensRevoked
                && remainingActive.Count == 0
                && otherTokensUntouched;
        });

    private static Gen<(int ActiveCount, int OtherCount, string TokenSecret, string NewPassword)> ScenarioGen() =>
        from activeCount in Gen.Choose(1, 8)
        from otherCount in Gen.Choose(0, 5)
        from tokenSecret in PasswordResetGenerators.TokenSecret()
        from newPassword in PasswordResetGenerators.PolicyCompliantPassword()
        select (activeCount, otherCount, tokenSecret, newPassword);
}
