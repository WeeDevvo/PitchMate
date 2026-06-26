using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Application.Auth;
using PitchMate.Application.Auth.PasswordReset;
using PitchMate.Domain.Auth;

namespace PitchMate.Application.Tests.Auth.PasswordReset;

/// <summary>
/// Property 28: A policy-violating reset password leaves all state unchanged.
/// <para>
/// For any redeemable reset token and any new password that violates the strength policy,
/// the redemption fails with <see cref="AuthErrorCode.PasswordPolicy"/> and nothing is
/// mutated: the stored hash is unchanged, the token remains unredeemed and still redeemable,
/// the user's refresh tokens stay active, and no unit of work is committed. Exercised over
/// in-memory fakes as a pure Application unit test, at least 100 iterations.
/// </para>
/// </summary>
[Trait("Feature", "auth-and-identity")]
public class PolicyViolatingResetPropertyTests
{
    private static readonly TimeSpan TokenLifetime = TimeSpan.FromMinutes(30);

    // Feature: auth-and-identity, Property 28: A policy-violating reset password leaves all
    // state unchanged. Validates: Requirements 5.7
    [Property(MaxTest = 100)]
    [Trait("Property", "28")]
    public Property PolicyViolatingReset_LeavesAllStateUnchanged() =>
        Prop.ForAll(Arb.From(ScenarioGen()), scenario =>
        {
            var (oldPassword, tokenSecret, badPassword, activeCount) = scenario;

            var harness = PasswordResetRedeemHarness.Create(
                oldPassword, tokenSecret, TokenLifetime,
                activeRefreshTokenCount: activeCount, otherUserRefreshTokenCount: 0);

            var result = harness.Handler
                .HandleAsync(new RedeemPasswordResetCommand(tokenSecret, badPassword), CancellationToken.None)
                .GetAwaiter()
                .GetResult();

            bool rejectedForPolicy =
                !result.IsSuccess && result.Error?.Code == AuthErrorCode.PasswordPolicy;

            bool hashUnchanged = harness.Credential.PasswordHash == harness.OriginalHash;
            bool tokenStillRedeemable =
                harness.Token.RedeemedAt is null
                && harness.Token.IsRedeemableAt(harness.Clock.GetUtcNow());
            bool refreshTokensStillActive =
                harness.UserRefreshTokens.All(t => t.Status == RefreshTokenStatus.Active);
            bool nothingCommitted = harness.UnitOfWork.SaveCount == 0;

            return rejectedForPolicy
                && hashUnchanged
                && tokenStillRedeemable
                && refreshTokensStillActive
                && nothingCommitted;
        });

    private static Gen<(string OldPassword, string TokenSecret, string BadPassword, int ActiveCount)> ScenarioGen() =>
        from oldPassword in PasswordResetGenerators.PolicyCompliantPassword()
        from tokenSecret in PasswordResetGenerators.TokenSecret()
        from badPassword in PasswordResetGenerators.PolicyViolatingPassword()
        from activeCount in Gen.Choose(0, 5)
        select (oldPassword, tokenSecret, badPassword, activeCount);
}
