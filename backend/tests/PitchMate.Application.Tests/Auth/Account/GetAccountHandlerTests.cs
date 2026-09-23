using PitchMate.Application.Auth;
using PitchMate.Application.Auth.UseCases;
using PitchMate.Domain.Auth;

namespace PitchMate.Application.Tests.Auth.Account;

/// <summary>
/// Example/unit tests for <see cref="GetAccountHandler"/>: the success path for a caller owning
/// several linked identities, the <see cref="AuthErrorCode.UserNotFound"/> path, and the
/// determinism of the identity ordering (Requirements 8.2, 8.3, 8.4, 8.5, 8.9, 8.10). The named
/// property invariants (Properties 15 and 16) are covered separately by tasks 4.2 and 4.3.
/// </summary>
[Trait("Feature", "api-response-contracts")]
public class GetAccountHandlerTests
{
    private static readonly DateTimeOffset Origin = new(2025, 3, 1, 9, 0, 0, TimeSpan.Zero);

    private sealed class Harness
    {
        public required AccountReadStore Store { get; init; }
        public required GetAccountHandler Handler { get; init; }

        public static Harness Create()
        {
            var store = new AccountReadStore();
            return new Harness
            {
                Store = store,
                Handler = new GetAccountHandler(
                    new AccountReadUserRepositoryFake(store),
                    new AccountReadAuthIdentityRepositoryFake(store)),
            };
        }
    }

    private static User SeedUser(
        AccountReadStore store,
        string displayName = "Dave",
        string email = "dave@example.test",
        bool emailVerified = true,
        string? avatarReference = "avatars/dave.png")
    {
        User user = User.Create(displayName, email, emailVerified, avatarReference);
        store.SeedUser(user);
        return user;
    }

    private static AuthIdentity SeedPasswordIdentity(
        AccountReadStore store, Guid userId, string email, DateTimeOffset linkedAt)
    {
        AuthIdentity identity = AuthIdentity.ForPassword(
            userId, email, PasswordCredential.Create($"hash-{Guid.NewGuid():N}"));
        identity.CreatedAt = linkedAt;
        store.SeedIdentity(identity);
        return identity;
    }

    private static AuthIdentity SeedExternalIdentity(
        AccountReadStore store, Guid userId, AuthProvider provider, DateTimeOffset linkedAt)
    {
        AuthIdentity identity = AuthIdentity.ForExternal(userId, provider, $"subject-{Guid.NewGuid():N}");
        identity.CreatedAt = linkedAt;
        store.SeedIdentity(identity);
        return identity;
    }

    [Fact]
    public async Task GetAccount_ForUserWithSeveralIdentities_ReturnsProfileAndEveryLinkedIdentity()
    {
        var harness = Harness.Create();
        User user = SeedUser(harness.Store);
        AuthIdentity password = SeedPasswordIdentity(harness.Store, user.Id, user.Email, Origin);
        AuthIdentity google = SeedExternalIdentity(
            harness.Store, user.Id, AuthProvider.Google, Origin.AddDays(1));
        AuthIdentity apple = SeedExternalIdentity(
            harness.Store, user.Id, AuthProvider.Apple, Origin.AddDays(2));

        Result<AccountView> result =
            await harness.Handler.HandleAsync(new GetAccountCommand(user.Id), CancellationToken.None);

        Assert.True(result.IsSuccess);
        AccountView view = result.Value!;

        // The profile is the caller's own.
        Assert.Equal(user.Id, view.UserId);
        Assert.Equal("Dave", view.DisplayName);
        Assert.Equal("dave@example.test", view.Email);
        Assert.True(view.EmailVerified);
        Assert.Equal("avatars/dave.png", view.AvatarReference);

        // Exactly one entry per linked identity, carrying the real AuthIdentity.Id that unlink
        // accepts, the provider kind, and the creation instant as the linked instant.
        Assert.Equal(3, view.LinkedIdentities.Count);
        Assert.Equal(
            new[] { password.Id, google.Id, apple.Id },
            view.LinkedIdentities.Select(identity => identity.IdentityId));
        Assert.Equal(
            new[] { AuthProvider.Password, AuthProvider.Google, AuthProvider.Apple },
            view.LinkedIdentities.Select(identity => identity.Provider));
        Assert.Equal(
            new[] { Origin, Origin.AddDays(1), Origin.AddDays(2) },
            view.LinkedIdentities.Select(identity => identity.LinkedAt));

        // The read is scoped to the caller: the identity listing is asked only for that user.
        Assert.Equal(new[] { user.Id }, harness.Store.IdentityListCalls);
    }

    [Fact]
    public async Task GetAccount_ReturnsOnlyTheCallersOwnIdentities()
    {
        var harness = Harness.Create();
        User caller = SeedUser(harness.Store, "Dave", "dave@example.test");
        User other = SeedUser(harness.Store, "BigDave", "bigdave@example.test");
        AuthIdentity callerIdentity = SeedPasswordIdentity(
            harness.Store, caller.Id, caller.Email, Origin);
        AuthIdentity otherIdentity = SeedPasswordIdentity(
            harness.Store, other.Id, other.Email, Origin);

        Result<AccountView> result =
            await harness.Handler.HandleAsync(new GetAccountCommand(caller.Id), CancellationToken.None);

        Assert.True(result.IsSuccess);
        AccountView view = result.Value!;
        Assert.Equal(caller.Id, view.UserId);
        Assert.Equal(new[] { callerIdentity.Id }, view.LinkedIdentities.Select(i => i.IdentityId));
        Assert.DoesNotContain(otherIdentity.Id, view.LinkedIdentities.Select(i => i.IdentityId));
    }

    [Fact]
    public async Task GetAccount_ForUnknownUser_FailsWithUserNotFoundAndNoView()
    {
        var harness = Harness.Create();
        User existing = SeedUser(harness.Store);
        SeedPasswordIdentity(harness.Store, existing.Id, existing.Email, Origin);

        Guid unknownId = Guid.CreateVersion7();

        Result<AccountView> result =
            await harness.Handler.HandleAsync(new GetAccountCommand(unknownId), CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Null(result.Value);
        Assert.Equal(AuthErrorCode.UserNotFound, result.Error!.Code);

        // No identity read happens for a user that does not exist.
        Assert.Empty(harness.Store.IdentityListCalls);
    }

    [Fact]
    public async Task GetAccount_OrdersIdentitiesByLinkedInstantRegardlessOfRepositoryOrder()
    {
        var harness = Harness.Create();
        User user = SeedUser(harness.Store);

        // Seed newest-first, so seed order is the reverse of the expected view order.
        AuthIdentity newest = SeedExternalIdentity(
            harness.Store, user.Id, AuthProvider.Apple, Origin.AddDays(2));
        AuthIdentity middle = SeedExternalIdentity(
            harness.Store, user.Id, AuthProvider.Google, Origin.AddDays(1));
        AuthIdentity oldest = SeedPasswordIdentity(harness.Store, user.Id, user.Email, Origin);

        Result<AccountView> result =
            await harness.Handler.HandleAsync(new GetAccountCommand(user.Id), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(
            new[] { oldest.Id, middle.Id, newest.Id },
            result.Value!.LinkedIdentities.Select(identity => identity.IdentityId));
    }

    [Fact]
    public async Task GetAccount_BreaksTiedLinkedInstantsByIdentityId()
    {
        var harness = Harness.Create();
        User user = SeedUser(harness.Store);

        // Three identities linked at the very same instant: the identity id is the tie-break.
        AuthIdentity password = SeedPasswordIdentity(harness.Store, user.Id, user.Email, Origin);
        AuthIdentity google = SeedExternalIdentity(harness.Store, user.Id, AuthProvider.Google, Origin);
        AuthIdentity apple = SeedExternalIdentity(harness.Store, user.Id, AuthProvider.Apple, Origin);

        Guid[] expected = new[] { password.Id, google.Id, apple.Id }
            .OrderBy(id => id)
            .ToArray();

        Result<AccountView> result =
            await harness.Handler.HandleAsync(new GetAccountCommand(user.Id), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(expected, result.Value!.LinkedIdentities.Select(identity => identity.IdentityId));
    }

    [Fact]
    public async Task GetAccount_IsStableAcrossRepeatedReadsOfTheSameIdentitySet()
    {
        var harness = Harness.Create();
        User user = SeedUser(harness.Store);
        SeedPasswordIdentity(harness.Store, user.Id, user.Email, Origin);
        SeedExternalIdentity(harness.Store, user.Id, AuthProvider.Google, Origin);
        SeedExternalIdentity(harness.Store, user.Id, AuthProvider.Apple, Origin.AddDays(1));

        Result<AccountView> first =
            await harness.Handler.HandleAsync(new GetAccountCommand(user.Id), CancellationToken.None);
        Result<AccountView> second =
            await harness.Handler.HandleAsync(new GetAccountCommand(user.Id), CancellationToken.None);

        Assert.True(first.IsSuccess);
        Assert.True(second.IsSuccess);
        Assert.Equal(
            first.Value!.LinkedIdentities.Select(identity => identity.IdentityId),
            second.Value!.LinkedIdentities.Select(identity => identity.IdentityId));
    }

    [Fact]
    public async Task GetAccount_ForAnExistingUser_ReachesAtLeastOneLinkedIdentity()
    {
        var harness = Harness.Create();
        User user = SeedUser(harness.Store, avatarReference: null);
        SeedPasswordIdentity(harness.Store, user.Id, user.Email, Origin);

        Result<AccountView> result =
            await harness.Handler.HandleAsync(new GetAccountCommand(user.Id), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Null(result.Value!.AvatarReference);
        Assert.NotEmpty(result.Value.LinkedIdentities);
    }
}
