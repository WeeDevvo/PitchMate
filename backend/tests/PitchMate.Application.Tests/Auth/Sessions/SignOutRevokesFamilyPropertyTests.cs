using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Application.Auth;
using PitchMate.Application.Auth.UseCases;
using PitchMate.Domain.Auth;

namespace PitchMate.Application.Tests.Auth.Sessions;

/// <summary>
/// Property 25: Sign-out revokes every token in the family (Requirement 9.4).
/// <para>
/// For any Token_Family of any size, built from a sign-in plus an arbitrary number of
/// rotations (so the family naturally carries a mix of <see cref="RefreshTokenStatus.Rotated"/>
/// predecessors and one <see cref="RefreshTokenStatus.Active"/> tail), presenting <em>any</em>
/// one of its members to <see cref="SignOutHandler"/> leaves <em>every</em> member of that
/// family <see cref="RefreshTokenStatus.Revoked"/>, committing atomically. A second, unrelated
/// family is left untouched, confirming revocation is scoped to the presented session's family.
/// Exercised over the shared in-memory session fakes as a pure Application unit test, at least
/// 100 iterations.
/// </para>
/// </summary>
[Trait("Feature", "auth-and-identity")]
public class SignOutRevokesFamilyPropertyTests
{
    private static readonly TimeSpan TokenLifetime = TimeSpan.FromDays(30);

    // Feature: auth-and-identity, Property 25: Sign-out revokes every token in the family.
    // Validates: Requirements 9.4
    [Property(MaxTest = 100)]
    [Trait("Property", "25")]
    public Property SignOut_RevokesEveryMemberOfThePresentedFamily_LeavingOtherFamiliesIntact() =>
        Prop.ForAll(Arb.From(ScenarioGen()), scenario =>
        {
            var (familySize, presentIndex, otherFamilySize) = scenario;

            var clock = new SessionFakeClock();
            var hasher = new SessionSecretHasherFake();
            var store = new SessionRefreshTokenStoreFake(clock);
            var unitOfWork = new SessionUnitOfWorkFake();
            var handler = new SignOutHandler(store, hasher, unitOfWork);

            DateTimeOffset expiresAt = SessionFakeClock.DefaultNow + TokenLifetime;

            // Build the target family: a head plus (familySize - 1) rotations. Each Rotate marks
            // its predecessor Rotated and yields a fresh Active successor, so the family ends up
            // with familySize-1 Rotated members and one Active tail — an arbitrary Active/Rotated mix.
            var familyUserId = Guid.CreateVersion7();
            var (familyMembers, familyPlaintexts) =
                BuildFamily(familyUserId, hasher, expiresAt, familySize, "fam");
            foreach (RefreshToken member in familyMembers)
            {
                store.Seed(member);
            }

            // A second, independent family for an unrelated user — must remain untouched.
            var otherUserId = Guid.CreateVersion7();
            var (otherMembers, _) =
                BuildFamily(otherUserId, hasher, expiresAt, otherFamilySize, "other");
            foreach (RefreshToken member in otherMembers)
            {
                store.Seed(member);
            }

            // Present ANY member of the target family (active tail, a rotated predecessor, anything).
            string presented = familyPlaintexts[presentIndex];
            var result = handler
                .HandleAsync(new SignOutCommand(presented), CancellationToken.None)
                .GetAwaiter()
                .GetResult();

            bool everyFamilyMemberRevoked =
                familyMembers.All(t => t.Status == RefreshTokenStatus.Revoked);
            bool otherFamilyUntouched =
                otherMembers.All(t => t.Status != RefreshTokenStatus.Revoked);

            return (result.IsSuccess
                    && everyFamilyMemberRevoked
                    && otherFamilyUntouched
                    && unitOfWork.SaveCount == 1)
                .Label($"familySize={familySize}, presentIndex={presentIndex}, " +
                       $"otherFamilySize={otherFamilySize}, saveCount={unitOfWork.SaveCount}");
        });

    /// <summary>
    /// Builds a token family rooted at a fresh sign-in followed by <paramref name="size"/>-1
    /// rotations, returning the members in chain order alongside the plaintext secret of each.
    /// </summary>
    private static (List<RefreshToken> Members, List<string> Plaintexts) BuildFamily(
        Guid userId,
        SessionSecretHasherFake hasher,
        DateTimeOffset expiresAt,
        int size,
        string prefix)
    {
        var members = new List<RefreshToken>(size);
        var plaintexts = new List<string>(size);

        string headPlaintext = $"{prefix}-{userId:N}-0";
        RefreshToken current = RefreshToken.StartFamily(userId, hasher.Hash(headPlaintext), expiresAt);
        members.Add(current);
        plaintexts.Add(headPlaintext);

        for (int i = 1; i < size; i++)
        {
            string plaintext = $"{prefix}-{userId:N}-{i}";
            current = current.Rotate(hasher.Hash(plaintext), expiresAt);
            members.Add(current);
            plaintexts.Add(plaintext);
        }

        return (members, plaintexts);
    }

    private static Gen<(int FamilySize, int PresentIndex, int OtherFamilySize)> ScenarioGen() =>
        from familySize in Gen.Choose(1, 8)
        from presentIndex in Gen.Choose(0, familySize - 1)
        from otherFamilySize in Gen.Choose(0, 5)
        select (familySize, presentIndex, otherFamilySize);
}
