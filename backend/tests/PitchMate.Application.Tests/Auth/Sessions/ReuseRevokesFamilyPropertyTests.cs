using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Application.Auth;
using PitchMate.Application.Auth.UseCases;
using PitchMate.Domain.Auth;

namespace PitchMate.Application.Tests.Auth.Sessions;

/// <summary>
/// Property 24: Reuse of a superseded refresh token revokes the whole family.
/// <para>
/// For any Token_Family containing rotated or revoked members, presenting any rotated or
/// revoked member to <see cref="RefreshSessionHandler"/> is rejected as
/// <see cref="AuthErrorCode.TokenInvalid"/>, issues no access or refresh token, and leaves
/// every member of that family revoked. The scenario builds a family through one or more
/// legitimate rotations (so it holds several rotated members plus one active successor),
/// then re-presents an earlier, now-superseded member — either one rotated by a prior
/// rotation, or the active successor after it has been directly revoked. Exercised over the
/// shared in-memory session fakes as a pure Application unit test, at least 100 iterations.
/// </para>
/// </summary>
[Trait("Feature", "auth-and-identity")]
public class ReuseRevokesFamilyPropertyTests
{
    private static readonly TimeSpan RefreshLifetime = TimeSpan.FromDays(30);

    // Feature: auth-and-identity, Property 24: Reuse of a superseded refresh token revokes the
    // whole family. Validates: Requirements 9.3
    [Property(MaxTest = 100)]
    [Trait("Property", "24")]
    public Property ReusingSupersededMember_IsRejected_IssuesNothing_AndRevokesWholeFamily() =>
        Prop.ForAll(Arb.From(ScenarioGen()), scenario =>
        {
            var (headSecret, rotationCount, reuseRotatedIndex, presentRevoked) = scenario;

            var harness = Harness.Create();
            RefreshToken head = harness.SeedActiveHead(headSecret);
            Guid familyId = head.TokenFamilyId;

            // Drive one or more legitimate rotations. Each presented secret becomes Rotated;
            // the call returns the successor's plaintext, which we present next.
            var supersededByRotation = new List<string> { headSecret };
            string activeSecret = headSecret;
            for (int i = 0; i < rotationCount; i++)
            {
                Result<RefreshSessionResult> rotated = harness.Handler
                    .HandleAsync(new RefreshSessionCommand(activeSecret), CancellationToken.None)
                    .GetAwaiter()
                    .GetResult();

                if (!rotated.IsSuccess || rotated.Value is null)
                {
                    return false; // setup rotations must all succeed
                }

                activeSecret = rotated.Value.RefreshToken;
                supersededByRotation.Add(activeSecret);
            }

            // After the loop, supersededByRotation holds [head, s1, ..., s_rotationCount]; the
            // last entry is the sole currently-active successor and the earlier ones are Rotated.
            // Decide which superseded member to replay.
            string reuseSecret;
            if (presentRevoked)
            {
                // Directly revoke the active successor (e.g. via sign-out / reset) and replay it,
                // exercising the "revoked member" arm of reuse detection.
                RefreshToken active = harness.RefreshTokens.All
                    .Single(t => t.TokenHash == harness.SecretHasher.Hash(activeSecret));
                active.Revoke();
                reuseSecret = activeSecret;
            }
            else
            {
                // Replay one of the members rotated by a prior rotation (indices 0..rotationCount-1).
                int index = reuseRotatedIndex % rotationCount;
                reuseSecret = supersededByRotation[index];
            }

            int issuedBefore = harness.TokenService.IssuedFor.Count;
            int tokensBefore = harness.RefreshTokens.All.Count;

            Result<RefreshSessionResult> result = harness.Handler
                .HandleAsync(new RefreshSessionCommand(reuseSecret), CancellationToken.None)
                .GetAwaiter()
                .GetResult();

            // Rejected as invalid, carrying no session payload.
            bool rejectedAsInvalid =
                !result.IsSuccess
                && result.Value is null
                && result.Error is not null
                && result.Error.Code == AuthErrorCode.TokenInvalid;

            // No access token minted and no successor refresh token added during reuse.
            bool nothingIssued =
                harness.TokenService.IssuedFor.Count == issuedBefore
                && harness.RefreshTokens.All.Count == tokensBefore;

            // Every member of the family is now revoked.
            var family = harness.RefreshTokens.All.Where(t => t.TokenFamilyId == familyId).ToList();
            bool wholeFamilyRevoked =
                family.Count == tokensBefore // entire family lives in this one family
                && family.All(t => t.Status == RefreshTokenStatus.Revoked);

            return rejectedAsInvalid && nothingIssued && wholeFamilyRevoked;
        });

    private static Gen<(string HeadSecret, int RotationCount, int ReuseRotatedIndex, bool PresentRevoked)> ScenarioGen() =>
        from headSecret in HeadSecret()
        from rotationCount in Gen.Choose(1, 6)
        from reuseRotatedIndex in Gen.Choose(0, 5)
        from presentRevoked in Gen.Elements(true, false)
        select (headSecret, rotationCount, reuseRotatedIndex, presentRevoked);

    private static readonly char[] AlphaNumeric =
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".ToCharArray();

    /// <summary>A unique, non-empty plaintext for the family head, prefixed so it can never
    /// collide with the "refresh-..." successor secrets minted by the token-service fake.</summary>
    private static Gen<string> HeadSecret() =>
        from chars in Gen.ListOf(Gen.Elements(AlphaNumeric))
        select "head-" + new string(chars.ToArray()) + "-" + Guid.NewGuid().ToString("N");

    /// <summary>
    /// Builds the refresh-session handler over the shared in-memory session fakes with one
    /// seeded user, mirroring the example-test harness but scoped to this property test.
    /// </summary>
    private sealed class Harness
    {
        public required SessionFakeClock Clock { get; init; }
        public required SessionSecretHasherFake SecretHasher { get; init; }
        public required SessionTokenServiceFake TokenService { get; init; }
        public required SessionRefreshTokenStoreFake RefreshTokens { get; init; }
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
                Handler = handler,
                UserId = user.Id,
            };
        }

        /// <summary>Seeds an active family head whose hash matches <paramref name="plaintext"/>.</summary>
        public RefreshToken SeedActiveHead(string plaintext)
        {
            DateTimeOffset expiresAt = Clock.GetUtcNow() + RefreshLifetime;
            var token = RefreshToken.StartFamily(UserId, SecretHasher.Hash(plaintext), expiresAt);
            RefreshTokens.Seed(token);
            return token;
        }
    }
}
