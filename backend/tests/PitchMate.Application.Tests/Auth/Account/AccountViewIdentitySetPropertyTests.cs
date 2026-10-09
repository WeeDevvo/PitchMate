using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Application.Auth;
using PitchMate.Application.Auth.UseCases;
using PitchMate.Domain.Auth;

namespace PitchMate.Application.Tests.Auth.Account;

/// <summary>
/// Property-based test for <see cref="GetAccountHandler"/> covering:
/// <list type="bullet">
///   <item><b>Property 15</b> — the account view mirrors the caller's own identity set
///   (Requirements 8.2, 8.3, 8.4, 8.5, 8.10).</item>
/// </list>
/// For any set of users, any caller among them, and any non-empty set of identities linked to that
/// caller, the view carries that caller's user identity and no other's, exactly one entry per
/// linked identity and no extra entry, each entry's id equal to the persisted
/// <see cref="AuthIdentity"/> id that unlinking accepts — and, for any permutation of the source
/// identities, the same entry order.
/// <para>
/// The test drives the real handler against the in-memory account-read fakes (no database), per the
/// Application-layer testing strategy. The fake identity listing deliberately returns identities in
/// <em>seed</em> order, so permuting the seed order is what exercises the handler's ordering:
/// each scenario is read three times — in generated order, with the caller's identities reversed
/// and the foreign ones moved ahead of them, and in a selector-driven shuffle of the whole set —
/// and all three reads must agree on the order.
/// </para>
/// <para>
/// Every scenario seeds at least two users, each non-caller user owning identities whose linked
/// instants straddle the caller's, so an entry leaking in from another user would break the count,
/// the id set <em>and</em> the order rather than hiding at the end of the list.
/// </para>
/// </summary>
[Trait("Feature", "api-response-contracts")]
public class AccountViewIdentitySetPropertyTests
{
    private static readonly DateTimeOffset Origin = new(2025, 3, 1, 9, 0, 0, TimeSpan.Zero);

    // Feature: api-response-contracts, Property 15: The account view mirrors the caller's own
    // identity set. For any set of users, any caller among them, and any non-empty set of
    // identities linked to that caller: the view carries that caller's id and no other's, exactly
    // one entry per linked identity with no extra entry, each entry's id equal to the persisted
    // AuthIdentity.Id, and the same entry order for any permutation of the source identities.
    // Validates: Requirements 8.2, 8.3, 8.4, 8.5, 8.10
    [Property(MaxTest = 200, Arbitrary = new[] { typeof(AccountViewScenarioGenerators) })]
    [Trait("Property", "15")]
    public Property Property15_AccountView_MirrorsTheCallersOwnIdentitySet(AccountViewScenario scenario)
    {
        // The users, created once and seeded into every read, so the caller's identity is stable
        // across the three seed orders below.
        List<User> users = Enumerable
            .Range(0, scenario.UserCount)
            .Select(BuildUser)
            .ToList();

        User caller = users[scenario.CallerIndex % users.Count];

        // The caller's own identities, and the identities of every other user. The foreign linked
        // instants sit either side of the caller's window (Origin .. Origin + 3 days), so a leaked
        // foreign entry cannot sort harmlessly to the end of the view.
        List<AuthIdentity> callerIdentities = BuildIdentities(caller, scenario.CallerIdentities);
        List<AuthIdentity> foreignIdentities = users
            .Where(user => user.Id != caller.Id)
            .SelectMany(BuildForeignIdentities)
            .ToList();

        // Three genuinely different seed orders of the same identity objects.
        List<AuthIdentity> generatedOrder = [.. callerIdentities, .. foreignIdentities];
        List<AuthIdentity> reversedOrder = [.. foreignIdentities, .. Enumerable.Reverse(callerIdentities)];
        List<AuthIdentity> shuffledOrder = Permute(generatedOrder, scenario.PermutationSelectors);

        (Result<AccountView> generatedResult, AccountReadStore generatedStore) =
            Read(users, generatedOrder, caller.Id);
        (Result<AccountView> reversedResult, _) = Read(users, reversedOrder, caller.Id);
        (Result<AccountView> shuffledResult, _) = Read(users, shuffledOrder, caller.Id);

        bool allSucceeded =
            generatedResult is { IsSuccess: true, Value: not null }
            && reversedResult is { IsSuccess: true, Value: not null }
            && shuffledResult is { IsSuccess: true, Value: not null };

        if (!allSucceeded)
        {
            return false.ToProperty();
        }

        AccountView view = generatedResult.Value!;

        // Requirement 8.2: the view describes the caller and no other user.
        bool carriesCallersIdentity = view.UserId == caller.Id;
        bool carriesNoOtherUsersIdentity = users
            .Where(user => user.Id != caller.Id)
            .All(user => view.UserId != user.Id);
        bool carriesCallersProfile =
            view.DisplayName == caller.DisplayName
            && view.Email == caller.Email
            && view.EmailVerified == caller.EmailVerified
            && view.AvatarReference == caller.AvatarReference;

        // Requirement 8.3: exactly one entry per linked identity, and no extra entry.
        bool oneEntryPerIdentity = view.LinkedIdentities.Count == callerIdentities.Count;
        bool noDuplicateEntries = view.LinkedIdentities
            .Select(entry => entry.IdentityId)
            .Distinct()
            .Count() == view.LinkedIdentities.Count;
        bool sameIdentitySet = view.LinkedIdentities
            .Select(entry => entry.IdentityId)
            .OrderBy(id => id)
            .SequenceEqual(callerIdentities.Select(identity => identity.Id).OrderBy(id => id));
        bool noForeignEntry = view.LinkedIdentities
            .All(entry => foreignIdentities.All(identity => identity.Id != entry.IdentityId));

        // Requirement 8.4: each entry's id is the persisted AuthIdentity.Id that unlink accepts,
        // beside that identity's own provider kind and linked instant.
        bool entriesMirrorTheirIdentity = view.LinkedIdentities.All(entry =>
        {
            AuthIdentity? source = callerIdentities.FirstOrDefault(identity => identity.Id == entry.IdentityId);
            return source is not null
                && entry.Provider == source.Provider
                && entry.LinkedAt == source.CreatedAt;
        });

        // Requirement 8.5: the same entry order for any permutation of the source identities.
        Guid[] generatedSequence = [.. view.LinkedIdentities.Select(entry => entry.IdentityId)];
        Guid[] reversedSequence = [.. reversedResult.Value!.LinkedIdentities.Select(entry => entry.IdentityId)];
        Guid[] shuffledSequence = [.. shuffledResult.Value!.LinkedIdentities.Select(entry => entry.IdentityId)];
        bool orderIsPermutationInvariant =
            generatedSequence.SequenceEqual(reversedSequence)
            && generatedSequence.SequenceEqual(shuffledSequence);

        // The read is scoped to the caller: the identity listing is asked for that user alone.
        bool readScopedToCaller = generatedStore.IdentityListCalls is [Guid asked] && asked == caller.Id;

        // Requirement 8.10, and the non-vacuity floor: the scenario really did seed a non-empty
        // caller identity set alongside at least one foreign identity, the view really did reach an
        // identity, and — wherever the caller owns more than one identity — the permuted source
        // orders really were different source orders, so the ordering conjunct cannot pass by
        // comparing a list with itself.
        bool nonVacuous =
            callerIdentities.Count >= 1
            && foreignIdentities.Count >= 1
            && view.LinkedIdentities.Count >= 1
            && (callerIdentities.Count < 2
                || !generatedOrder.Select(identity => identity.Id)
                    .SequenceEqual(reversedOrder.Select(identity => identity.Id)));

        return (carriesCallersIdentity
            && carriesNoOtherUsersIdentity
            && carriesCallersProfile
            && oneEntryPerIdentity
            && noDuplicateEntries
            && sameIdentitySet
            && noForeignEntry
            && entriesMirrorTheirIdentity
            && orderIsPermutationInvariant
            && readScopedToCaller
            && nonVacuous).ToProperty();
    }

    /// <summary>
    /// Runs the real handler over a freshly seeded store, seeding the identities in the supplied
    /// order so the caller's ordering is measured rather than inherited from the repository.
    /// </summary>
    private static (Result<AccountView> Result, AccountReadStore Store) Read(
        IReadOnlyList<User> users,
        IReadOnlyList<AuthIdentity> identitiesInSeedOrder,
        Guid callerId)
    {
        var store = new AccountReadStore();
        foreach (User user in users)
        {
            store.SeedUser(user);
        }

        foreach (AuthIdentity identity in identitiesInSeedOrder)
        {
            store.SeedIdentity(identity);
        }

        var handler = new GetAccountHandler(
            new AccountReadUserRepositoryFake(store),
            new AccountReadAuthIdentityRepositoryFake(store));

        Result<AccountView> result = handler
            .HandleAsync(new GetAccountCommand(callerId), CancellationToken.None)
            .GetAwaiter()
            .GetResult();

        return (result, store);
    }

    private static User BuildUser(int index) => User.Create(
        $"player{index}",
        $"player{index}@example.test",
        index % 2 == 0,
        index % 3 == 0 ? null : $"avatars/player{index}.png");

    /// <summary>
    /// Builds the caller's identities from the generated specs. Only the first identity may be a
    /// Password identity — the domain allows at most one per user — so a later Password spec is
    /// taken as a Google identity instead, keeping the seeded data inside the valid space.
    /// </summary>
    private static List<AuthIdentity> BuildIdentities(
        User user, IReadOnlyList<AccountLinkedIdentitySpec> specs)
    {
        var identities = new List<AuthIdentity>(specs.Count);
        for (int index = 0; index < specs.Count; index++)
        {
            AccountLinkedIdentitySpec spec = specs[index];
            AuthProvider provider = spec.Provider == AuthProvider.Password && index > 0
                ? AuthProvider.Google
                : spec.Provider;

            AuthIdentity identity = provider == AuthProvider.Password
                ? AuthIdentity.ForPassword(user.Id, user.Email, PasswordCredential.Create($"hash-{Guid.NewGuid():N}"))
                : AuthIdentity.ForExternal(user.Id, provider, $"subject-{index}-{Guid.NewGuid():N}");

            // Coarse day offsets so tied linked instants — where the identity id is the
            // tie-break — occur often rather than never.
            identity.CreatedAt = Origin.AddDays(spec.LinkedAtDayOffset);
            identities.Add(identity);
        }

        return identities;
    }

    /// <summary>
    /// Builds identities for a user who is not the caller, linked either side of the caller's
    /// window so a leaked entry would disturb the order as well as the count.
    /// </summary>
    private static List<AuthIdentity> BuildForeignIdentities(User user) =>
    [
        WithLinkedAt(
            AuthIdentity.ForPassword(user.Id, user.Email, PasswordCredential.Create($"hash-{Guid.NewGuid():N}")),
            Origin.AddDays(-1)),
        WithLinkedAt(
            AuthIdentity.ForExternal(user.Id, AuthProvider.Google, $"foreign-{Guid.NewGuid():N}"),
            Origin.AddDays(10)),
    ];

    private static AuthIdentity WithLinkedAt(AuthIdentity identity, DateTimeOffset linkedAt)
    {
        identity.CreatedAt = linkedAt;
        return identity;
    }

    /// <summary>
    /// A selector-driven Fisher-Yates shuffle, giving a reproducible arbitrary permutation of the
    /// seed order from the scenario's generated selectors.
    /// </summary>
    private static List<AuthIdentity> Permute(
        IReadOnlyList<AuthIdentity> source, IReadOnlyList<int> selectors)
    {
        var result = new List<AuthIdentity>(source);
        for (int i = result.Count - 1; i > 0; i--)
        {
            int selector = selectors.Count == 0 ? 0 : selectors[i % selectors.Count];
            int j = selector % (i + 1);
            (result[i], result[j]) = (result[j], result[i]);
        }

        return result;
    }
}

/// <summary>
/// One identity to link to the caller: the <see cref="AuthProvider"/> kind and a coarse day offset
/// from the scenario origin used as its linked instant, chosen from a small range so tied instants
/// — where the identity id is the ordering tie-break — arise often.
/// </summary>
public sealed record AccountLinkedIdentitySpec(AuthProvider Provider, int LinkedAtDayOffset);

/// <summary>
/// A scenario: how many users exist (always at least two, so "the caller's identity and no
/// other's" is never a vacuous claim), which of them is the caller, the non-empty set of identities
/// linked to that caller, and the selectors driving the shuffled seed order.
/// </summary>
public sealed record AccountViewScenario(
    int UserCount,
    int CallerIndex,
    IReadOnlyList<AccountLinkedIdentitySpec> CallerIdentities,
    IReadOnlyList<int> PermutationSelectors);

/// <summary>
/// FsCheck arbitraries for Property 15. The generator constrains inputs to the meaningful space:
/// 2–4 users with any one of them as the caller, 1–5 identities linked to that caller across all
/// three provider kinds, and 1–6 non-negative shuffle selectors. Referenced via
/// <c>[Property(Arbitrary = new[] { typeof(AccountViewScenarioGenerators) })]</c>.
/// </summary>
public static class AccountViewScenarioGenerators
{
    /// <summary>Arbitrary for a single account-view scenario.</summary>
    public static Arbitrary<AccountViewScenario> AccountViewScenario() => Arb.From(ScenarioGen());

    private static Gen<AccountViewScenario> ScenarioGen() =>
        from userCount in Gen.Choose(2, 4)
        from callerIndex in Gen.Choose(0, 3)
        from identityCount in Gen.Choose(1, 5)
        from identities in ListOfLength(identityCount, IdentitySpecGen())
        from selectorCount in Gen.Choose(1, 6)
        from selectors in ListOfLength(selectorCount, Gen.Choose(0, 999))
        select new AccountViewScenario(userCount, callerIndex, identities, selectors);

    private static Gen<AccountLinkedIdentitySpec> IdentitySpecGen() =>
        from provider in Gen.Elements(AuthProvider.Password, AuthProvider.Google, AuthProvider.Apple)
        from dayOffset in Gen.Choose(0, 3)
        select new AccountLinkedIdentitySpec(provider, dayOffset);

    /// <summary>Builds a generator for a list of exactly <paramref name="length"/> items.</summary>
    private static Gen<IReadOnlyList<T>> ListOfLength<T>(int length, Gen<T> element)
    {
        if (length <= 0)
        {
            return Gen.Constant<IReadOnlyList<T>>([]);
        }

        return from head in element
               from tail in ListOfLength(length - 1, element)
               select Prepend(head, tail);
    }

    private static IReadOnlyList<T> Prepend<T>(T head, IReadOnlyList<T> tail)
    {
        var result = new List<T>(tail.Count + 1) { head };
        result.AddRange(tail);
        return result;
    }
}
