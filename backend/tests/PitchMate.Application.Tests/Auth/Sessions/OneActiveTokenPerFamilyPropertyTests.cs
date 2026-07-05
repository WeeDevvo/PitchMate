using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Application.Auth;
using PitchMate.Application.Auth.UseCases;
using PitchMate.Domain.Auth;

namespace PitchMate.Application.Tests.Auth.Sessions;

/// <summary>
/// Property 23: A token family has exactly one active refresh token across any rotation sequence.
/// <para>
/// Starting from a freshly signed-in family head and applying an arbitrary-length sequence of
/// valid refresh operations — each presenting the current active token's plaintext — the token
/// family contains <strong>exactly one</strong> <see cref="RefreshTokenStatus.Active"/> refresh
/// token at every step: the presented token becomes <see cref="RefreshTokenStatus.Rotated"/> and
/// only the new successor is active, while every prior member is rotated (none revoked). Driven
/// through <see cref="RefreshSessionHandler"/> over in-memory fakes as a pure Application unit
/// test, at least 100 iterations.
/// </para>
/// </summary>
[Trait("Feature", "auth-and-identity")]
public class OneActiveTokenPerFamilyPropertyTests
{
    private const string HeadPlaintext = "family-head-secret";
    private static readonly TimeSpan RefreshLifetime = TimeSpan.FromDays(30);

    // Feature: auth-and-identity, Property 23: A token family has exactly one active refresh
    // token across any rotation sequence.
    // Validates: Requirements 9.2, 9.7
    [Property(MaxTest = 100)]
    [Trait("Property", "23")]
    public Property TokenFamily_HasExactlyOneActiveToken_AcrossAnyRotationSequence() =>
        Prop.ForAll(Arb.From(RotationCountGen()), rotations =>
        {
            var clock = new SessionFakeClock();
            var secretHasher = new SessionSecretHasherFake();
            var tokenService = new SessionTokenServiceFake(clock) { RefreshTokenLifetime = RefreshLifetime };
            var refreshTokens = new SessionRefreshTokenStoreFake(clock);
            var users = new SessionUserRepositoryFake();
            var unitOfWork = new SessionUnitOfWorkFake();

            var user = User.Create("Pat Player", "pat@example.com");
            users.Seed(user);

            var handler = new RefreshSessionHandler(
                refreshTokens, users, tokenService, secretHasher, unitOfWork, clock);

            // Seed the freshly signed-in family head: a single active token.
            DateTimeOffset headExpiry = clock.GetUtcNow() + RefreshLifetime;
            RefreshToken head = RefreshToken.StartFamily(user.Id, secretHasher.Hash(HeadPlaintext), headExpiry);
            refreshTokens.Seed(head);
            Guid familyId = head.TokenFamilyId;

            // The invariant must already hold on the freshly signed-in head (zero rotations).
            if (!InvariantHolds(refreshTokens, familyId, expectedMembers: 1))
            {
                return false;
            }

            string currentPlaintext = HeadPlaintext;

            for (int step = 1; step <= rotations; step++)
            {
                Result<RefreshSessionResult> result = handler
                    .HandleAsync(new RefreshSessionCommand(currentPlaintext), CancellationToken.None)
                    .GetAwaiter()
                    .GetResult();

                // Every presented token is the current active member, so each refresh succeeds.
                if (!result.IsSuccess || result.Value is null)
                {
                    return false;
                }

                // After this rotation the family has grown by exactly one member and still holds
                // exactly one active token (Requirements 9.2, 9.7).
                if (!InvariantHolds(refreshTokens, familyId, expectedMembers: step + 1))
                {
                    return false;
                }

                // The presented secret is now rotated, never revoked.
                RefreshToken presented = refreshTokens.All
                    .Single(t => t.TokenHash == secretHasher.Hash(currentPlaintext));
                if (presented.Status != RefreshTokenStatus.Rotated)
                {
                    return false;
                }

                // The successor returned to the caller is the sole active member of the family.
                RefreshToken successor = refreshTokens.All
                    .Single(t => t.TokenFamilyId == familyId && t.Status == RefreshTokenStatus.Active);
                if (successor.TokenHash != secretHasher.Hash(result.Value.RefreshToken))
                {
                    return false;
                }

                currentPlaintext = result.Value.RefreshToken;
            }

            return true;
        });

    /// <summary>
    /// Verifies the single-active-token invariant for <paramref name="familyId"/>: the family has
    /// exactly the expected number of members, exactly one of them is active, and every other
    /// member is rotated (never revoked under a sequence of valid refreshes).
    /// </summary>
    private static bool InvariantHolds(
        SessionRefreshTokenStoreFake store,
        Guid familyId,
        int expectedMembers)
    {
        var family = store.All.Where(t => t.TokenFamilyId == familyId).ToList();

        bool correctMemberCount = family.Count == expectedMembers;
        bool exactlyOneActive = family.Count(t => t.Status == RefreshTokenStatus.Active) == 1;
        bool allOthersRotated = family
            .Where(t => t.Status != RefreshTokenStatus.Active)
            .All(t => t.Status == RefreshTokenStatus.Rotated);

        return correctMemberCount && exactlyOneActive && allOthersRotated;
    }

    // An arbitrary-length sequence of valid refreshes, including the zero-rotation case.
    private static Gen<int> RotationCountGen() => Gen.Choose(0, 25);
}
