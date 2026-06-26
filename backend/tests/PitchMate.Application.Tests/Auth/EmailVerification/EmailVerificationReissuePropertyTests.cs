using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using Microsoft.Extensions.Options;
using PitchMate.Application.Auth;
using PitchMate.Application.Auth.EmailVerification;
using PitchMate.Domain.Auth;
using Result = PitchMate.Application.Auth.Result;

namespace PitchMate.Application.Tests.Auth.EmailVerification;

/// <summary>
/// Property-based tests for re-issuing email-verification tokens.
/// <para>
/// <b>Property 7: At most one redeemable single-use token after re-issue.</b>
/// Requesting a fresh verification token for a user supersedes any prior unredeemed token, so
/// no matter how many times verification is re-initiated, at most one token is ever redeemable
/// at a time (Requirement 4.8; the password-reset side of the same supersede rule is
/// Requirement 5.10).
/// </para>
/// <para>
/// The properties run against hand-written in-memory fakes (no database, no mocking framework)
/// and an <see cref="EmailVerificationFakeTimeProvider"/> for clock-dependent redeemability,
/// at least 100 iterations each.
/// </para>
/// <para><b>Validates: Requirements 4.8, 5.10</b></para>
/// </summary>
[Trait("Feature", "auth-and-identity")]
public class EmailVerificationReissuePropertyTests
{
    private static readonly DateTimeOffset ClockStart =
        new(2025, 1, 1, 12, 0, 0, TimeSpan.Zero);

    // Property 7: After issuing a verification token and re-issuing it any number of times,
    // exactly one token is redeemable for the user after every issuance — prior unredeemed
    // tokens are superseded. Validates: Requirements 4.8, 5.10
    [Property(MaxTest = 100)]
    [Trait("Property", "7")]
    public Property ReIssue_LeavesAtMostOneRedeemableToken() =>
        Prop.ForAll(Arb.From(ScenarioGen()), scenario =>
        {
            var (userId, reissueCount, lifetime) = scenario;

            var clock = new EmailVerificationFakeTimeProvider(ClockStart);
            var tokens = new EmailVerificationFakeTokenRepository(clock);
            var users = new EmailVerificationFakeUserRepository();
            var emailSender = new EmailVerificationFakeEmailSender();
            var unitOfWork = new EmailVerificationFakeUnitOfWork();

            User user = User.Create("Test Player", $"user-{userId:N}@example.test");
            // Re-key the seeded user onto the generated id is unnecessary; use the user's own id.
            users.Seed(user);

            var handler = new RequestEmailVerificationHandler(
                users,
                tokens,
                new EmailVerificationFakeTokenGenerator(),
                new EmailVerificationFakeSecretHasher(),
                emailSender,
                unitOfWork,
                clock,
                Options.Create(new EmailVerificationOptions { TokenLifetime = lifetime }));

            // Initial issue plus the generated number of re-issues. After every successful
            // issuance there must be exactly one redeemable token for the user.
            int totalIssues = reissueCount + 1;
            for (int i = 0; i < totalIssues; i++)
            {
                Result result = handler
                    .HandleAsync(new RequestEmailVerificationCommand(user.Id), CancellationToken.None)
                    .GetAwaiter()
                    .GetResult();

                if (!result.IsSuccess)
                {
                    return false;
                }

                if (tokens.RedeemableCountFor(user.Id) != 1)
                {
                    return false;
                }
            }

            // Every issuance persisted a token, but only the last remains redeemable.
            bool allPersisted = tokens.All.Count == totalIssues;
            bool oneRedeemable = tokens.RedeemableCountFor(user.Id) == 1;
            bool priorsSuperseded = tokens.All.Count(t => t.RedeemedAt is null) == 1;

            return allPersisted && oneRedeemable && priorsSuperseded;
        });

    /// <summary>
    /// A scenario: an owning user id, the number of re-issues (1–10) after the initial issue,
    /// and a token lifetime within the permitted 1-hour–7-day range.
    /// </summary>
    private static Gen<(Guid UserId, int ReissueCount, TimeSpan Lifetime)> ScenarioGen() =>
        from _ in Gen.Constant(0)
        let userId = Guid.CreateVersion7()
        from reissueCount in Gen.Choose(1, 10)
        from lifetimeMinutes in Gen.Choose(
            (int)EmailVerificationOptions.MinTokenLifetime.TotalMinutes,
            (int)EmailVerificationOptions.MaxTokenLifetime.TotalMinutes)
        select (userId, reissueCount, TimeSpan.FromMinutes(lifetimeMinutes));
}
