using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Application.Auth;
using PitchMate.Application.Auth.UseCases;
using PitchMate.Domain.Auth;
using Result = PitchMate.Application.Auth.Result;

namespace PitchMate.Application.Tests.Auth.Linking;

/// <summary>
/// Property-based test for the unlink last-identity guard (Requirements 10.6, 10.7):
/// <list type="bullet">
///   <item><b>Property 31</b> — a user always retains at least one sign-in method. For a user
///   that starts with N ≥ 1 identities, unlinking succeeds only when at least one identity
///   would remain afterwards; an attempt to remove the sole/last remaining identity is rejected
///   with <see cref="AuthErrorCode.LastIdentity"/> and changes nothing; and after any sequence
///   of unlink operations the user still owns at least one <see cref="AuthIdentity"/>.</item>
/// </list>
/// The test drives the real <see cref="UnlinkAuthIdentityHandler"/> against in-memory fakes
/// (no database), per the Application-layer testing strategy. Each generated operation targets
/// one of three cases — an identity the user still owns, a foreign identity owned by another
/// user, or an unknown id — so the invariant is exercised across allowed removals, rejected
/// last-identity removals, and no-op validation failures, all while the count is driven down
/// toward the floor of one.
/// </summary>
[Trait("Feature", "auth-and-identity")]
public class RetainsSignInMethodPropertyTests
{
    // Feature: auth-and-identity, Property 31: A user always retains at least one sign-in method.
    // Validates: Requirements 10.6, 10.7
    [Property(MaxTest = 100, Arbitrary = new[] { typeof(UnlinkScenarioGenerators) })]
    [Trait("Property", "31")]
    public Property Property31_UserAlwaysRetainsAtLeastOneSignInMethod(UnlinkScenario scenario)
    {
        var repository = new UnlinkFakeIdentityRepository();
        var unitOfWork = new UnlinkFakeUnitOfWork();

        // The user under test, seeded with N >= 1 identities. Index 0 is optionally a Password
        // identity (keyed on its normalised email); the rest are external identities with
        // guaranteed-distinct subjects, honouring the unique (Provider, ProviderUserId) index.
        var userId = Guid.NewGuid();
        for (int i = 0; i < scenario.IdentityCount; i++)
        {
            AuthIdentity identity = i == 0 && scenario.IncludePassword
                ? AuthIdentity.ForPassword(userId, $"user-{userId:N}@example.test", PasswordCredential.Create("stored-hash"))
                : AuthIdentity.ForExternal(userId, AuthProvider.Google, $"sub-{i}-{Guid.NewGuid():N}");
            repository.Seed(identity);
        }

        // A second user with its own identity. The handler must never touch it: it proves
        // ownership scoping and supplies a "foreign" target whose removal is a no-op failure.
        var otherUserId = Guid.NewGuid();
        AuthIdentity foreignIdentity = AuthIdentity.ForExternal(otherUserId, AuthProvider.Google, "foreign-sub");
        repository.Seed(foreignIdentity);

        var handler = new UnlinkAuthIdentityHandler(repository, unitOfWork);

        bool holds = true;
        foreach (int selector in scenario.Selectors)
        {
            IReadOnlyList<AuthIdentity> ownedBefore = repository.ForUser(userId);
            int countBefore = ownedBefore.Count;

            // Invariant entering every operation: the user always owns at least one identity.
            if (countBefore < 1)
            {
                holds = false;
                break;
            }

            // Pick the target: an unknown id, the foreign user's identity, or one the user owns.
            UnlinkTarget kind = (UnlinkTarget)(selector % 3);
            Guid targetId = kind switch
            {
                UnlinkTarget.Unknown => Guid.NewGuid(),
                UnlinkTarget.Foreign => foreignIdentity.Id,
                _ => ownedBefore[selector % countBefore].Id,
            };

            Result result = handler
                .HandleAsync(new UnlinkAuthIdentityCommand(userId, targetId), CancellationToken.None)
                .GetAwaiter()
                .GetResult();

            int countAfter = repository.ForUser(userId).Count;

            bool stepHolds = kind switch
            {
                // A target the user does not own (unknown or foreign) removes nothing and fails
                // with a validation error; the user's identity set is unchanged.
                UnlinkTarget.Unknown or UnlinkTarget.Foreign =>
                    result is { IsSuccess: false, Error.Code: AuthErrorCode.ValidationFailed }
                    && countAfter == countBefore,

                // An owned target that is the user's last remaining identity is rejected with
                // LastIdentity and changes nothing (Requirement 10.7).
                _ when countBefore <= 1 =>
                    result is { IsSuccess: false, Error.Code: AuthErrorCode.LastIdentity }
                    && countAfter == countBefore,

                // An owned target with others remaining is removed, leaving the rest intact
                // (Requirement 10.6).
                _ => result.IsSuccess && countAfter == countBefore - 1,
            };

            // The closing invariant after every operation: at least one sign-in method remains,
            // and the foreign user's identity is never disturbed.
            holds =
                stepHolds
                && countAfter >= 1
                && repository.Contains(foreignIdentity.Id);

            if (!holds)
            {
                break;
            }
        }

        return holds.ToProperty();
    }
}

/// <summary>Which identity an unlink operation targets.</summary>
public enum UnlinkTarget
{
    /// <summary>A random id that exists for no user; removal is a no-op validation failure.</summary>
    Unknown = 0,

    /// <summary>An identity owned by a different user; removal is a no-op validation failure.</summary>
    Foreign = 1,

    /// <summary>An identity the requesting user still owns.</summary>
    Owned = 2,
}

/// <summary>
/// A scenario: how many identities the user starts with (N ≥ 1), whether the first is a Password
/// identity, and a sequence of operation selectors. Each selector is reduced at run time to an
/// operation kind and (for owned targets) an index into the user's still-present identities, so
/// the sequence drives the count down toward the floor of one across allowed and rejected unlinks.
/// </summary>
public sealed record UnlinkScenario(
    int IdentityCount,
    bool IncludePassword,
    IReadOnlyList<int> Selectors);

/// <summary>
/// FsCheck arbitraries for Property 31. The generator constrains inputs to the meaningful space:
/// a starting identity count of 1–5, an optional leading Password identity, and 1–12 non-negative
/// operation selectors. Referenced via
/// <c>[Property(Arbitrary = new[] { typeof(UnlinkScenarioGenerators) })]</c>.
/// </summary>
public static class UnlinkScenarioGenerators
{
    /// <summary>Arbitrary for a single unlink scenario.</summary>
    public static Arbitrary<UnlinkScenario> UnlinkScenario() => Arb.From(ScenarioGen());

    private static Gen<UnlinkScenario> ScenarioGen() =>
        from identityCount in Gen.Choose(1, 5)
        from includePassword in Gen.Elements(true, false)
        from numOps in Gen.Choose(1, 12)
        from selectors in ListOfLength(numOps, Gen.Choose(0, 999))
        select new UnlinkScenario(identityCount, includePassword, selectors);

    /// <summary>Builds a generator for a list of exactly <paramref name="length"/> items.</summary>
    private static Gen<IReadOnlyList<int>> ListOfLength(int length, Gen<int> element)
    {
        if (length <= 0)
        {
            return Gen.Constant<IReadOnlyList<int>>([]);
        }

        return from head in element
               from tail in ListOfLength(length - 1, element)
               select Prepend(head, tail);
    }

    private static IReadOnlyList<int> Prepend(int head, IReadOnlyList<int> tail)
    {
        var result = new List<int>(tail.Count + 1) { head };
        result.AddRange(tail);
        return result;
    }
}
