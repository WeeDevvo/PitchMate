using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Application.Auth.Abstractions;
using PitchMate.Application.Auth.PasswordReset;

namespace PitchMate.Application.Tests.Auth.PasswordReset;

/// <summary>
/// Property 26: Password reset replaces the hash so the new password verifies.
/// <para>
/// For any redeemable reset token and any policy-compliant new password, redeeming the
/// token replaces the stored credential hash with a hash of the new password — so the new
/// password verifies against the stored hash afterwards — and the token is marked redeemed.
/// The handler is exercised over in-memory fakes as a pure Application unit test, at least
/// 100 iterations.
/// </para>
/// </summary>
[Trait("Feature", "auth-and-identity")]
public class ResetReplacesHashPropertyTests
{
    private static readonly TimeSpan TokenLifetime = TimeSpan.FromMinutes(30);

    // Feature: auth-and-identity, Property 26: Password reset replaces the hash so the new
    // password verifies. Validates: Requirements 5.3
    [Property(MaxTest = 100)]
    [Trait("Property", "26")]
    public Property SuccessfulReset_ReplacesHash_NewPasswordVerifies() =>
        Prop.ForAll(Arb.From(ScenarioGen()), scenario =>
        {
            var (oldPassword, tokenSecret, newPassword) = scenario;

            var harness = PasswordResetRedeemHarness.Create(
                oldPassword, tokenSecret, TokenLifetime,
                activeRefreshTokenCount: 0, otherUserRefreshTokenCount: 0);

            var result = harness.Handler
                .HandleAsync(new RedeemPasswordResetCommand(tokenSecret, newPassword), CancellationToken.None)
                .GetAwaiter()
                .GetResult();

            // The reset succeeds, the new password now verifies against the stored hash, and
            // the token has been spent.
            bool newPasswordVerifies =
                harness.PasswordHasher.Verify(harness.Credential.PasswordHash, newPassword)
                    == PasswordVerification.Success;

            return result.IsSuccess
                && newPasswordVerifies
                && harness.Token.RedeemedAt is not null;
        });

    private static Gen<(string OldPassword, string TokenSecret, string NewPassword)> ScenarioGen() =>
        from oldPassword in PasswordResetGenerators.PolicyCompliantPassword()
        from tokenSecret in PasswordResetGenerators.TokenSecret()
        from newPassword in PasswordResetGenerators.PolicyCompliantPassword()
        select (oldPassword, tokenSecret, newPassword);
}
