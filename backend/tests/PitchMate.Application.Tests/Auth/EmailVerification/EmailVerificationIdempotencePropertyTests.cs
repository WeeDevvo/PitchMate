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
/// Property-based tests for the idempotence of email verification.
/// <para>
/// <b>Property 8: Email verification is idempotent on an already-verified address.</b>
/// Once a user's email is verified, redeeming any subsequent still-valid verification token
/// leaves the address verified and reports success without error, no matter how many times it
/// happens (Requirement 4.9).
/// </para>
/// <para>
/// The properties run against hand-written in-memory fakes (no database, no mocking framework)
/// and an <see cref="EmailVerificationFakeTimeProvider"/> for clock-dependent redeemability,
/// at least 100 iterations each.
/// </para>
/// <para><b>Validates: Requirement 4.9</b></para>
/// </summary>
[Trait("Feature", "auth-and-identity")]
public class EmailVerificationIdempotencePropertyTests
{
    private static readonly DateTimeOffset ClockStart =
        new(2025, 1, 1, 12, 0, 0, TimeSpan.Zero);

    // Property 8: Starting from a verified email (verified up-front or by an initial redemption),
    // every subsequent redemption of a still-valid token succeeds and leaves the address verified.
    // Validates: Requirement 4.9
    [Property(MaxTest = 100)]
    [Trait("Property", "8")]
    public Property Verification_IsIdempotent_OnAlreadyVerifiedAddress() =>
        Prop.ForAll(Arb.From(ScenarioGen()), scenario =>
        {
            var (startVerified, rounds, lifetime) = scenario;

            var clock = new EmailVerificationFakeTimeProvider(ClockStart);
            var tokens = new EmailVerificationFakeTokenRepository(clock);
            var users = new EmailVerificationFakeUserRepository();
            var hasher = new EmailVerificationFakeSecretHasher();
            var generator = new EmailVerificationFakeTokenGenerator();
            var emailSender = new EmailVerificationFakeEmailSender();
            var unitOfWork = new EmailVerificationFakeUnitOfWork();

            User user = User.Create("Test Player", "idempotent@example.test", emailVerified: startVerified);
            users.Seed(user);

            var requestHandler = new RequestEmailVerificationHandler(
                users,
                tokens,
                generator,
                hasher,
                emailSender,
                unitOfWork,
                clock,
                Options.Create(new EmailVerificationOptions { TokenLifetime = lifetime }));

            var redeemHandler = new RedeemEmailVerificationHandler(
                tokens,
                users,
                hasher,
                unitOfWork,
                clock);

            // If the user did not start verified, an initial request+redeem must verify it.
            if (!startVerified)
            {
                if (!IssueAndRedeem(requestHandler, redeemHandler, generator, user.Id))
                {
                    return false;
                }

                if (!user.EmailVerified)
                {
                    return false;
                }
            }

            // The address is now verified. Each further redemption of a still-valid token must
            // succeed and leave the address verified — idempotence (Requirement 4.9).
            for (int i = 0; i < rounds; i++)
            {
                if (!IssueAndRedeem(requestHandler, redeemHandler, generator, user.Id))
                {
                    return false;
                }

                if (!user.EmailVerified)
                {
                    return false;
                }
            }

            return user.EmailVerified;
        });

    /// <summary>
    /// Issues a fresh verification token for <paramref name="userId"/> and immediately redeems
    /// it, returning whether both steps reported success.
    /// </summary>
    private static bool IssueAndRedeem(
        RequestEmailVerificationHandler requestHandler,
        RedeemEmailVerificationHandler redeemHandler,
        EmailVerificationFakeTokenGenerator generator,
        Guid userId)
    {
        Result issue = requestHandler
            .HandleAsync(new RequestEmailVerificationCommand(userId), CancellationToken.None)
            .GetAwaiter()
            .GetResult();
        if (!issue.IsSuccess)
        {
            return false;
        }

        string secret = generator.LastSecret!;
        Result redeem = redeemHandler
            .HandleAsync(new RedeemEmailVerificationCommand(secret), CancellationToken.None)
            .GetAwaiter()
            .GetResult();

        return redeem.IsSuccess;
    }

    /// <summary>
    /// A scenario: whether the user begins already verified, how many idempotent
    /// redemption rounds to run (1–5), and a token lifetime within the permitted range.
    /// </summary>
    private static Gen<(bool StartVerified, int Rounds, TimeSpan Lifetime)> ScenarioGen() =>
        from startVerified in Gen.Elements(true, false)
        from rounds in Gen.Choose(1, 5)
        from lifetimeMinutes in Gen.Choose(
            (int)EmailVerificationOptions.MinTokenLifetime.TotalMinutes,
            (int)EmailVerificationOptions.MaxTokenLifetime.TotalMinutes)
        select (startVerified, rounds, TimeSpan.FromMinutes(lifetimeMinutes));
}
