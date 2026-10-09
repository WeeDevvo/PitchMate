using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;
using PitchMate.Application.Auth;
using PitchMate.Application.Auth.Abstractions;
using PitchMate.Application.Auth.UseCases;
using PitchMate.Domain.Auth;
using HttpJsonOptions = Microsoft.AspNetCore.Http.Json.JsonOptions;

namespace PitchMate.Api.Tests.Auth;

/// <summary>
/// Integration tests over the real Api host for the account-settings read, <c>GET /auth/me</c>
/// (task 4.4): the route is mapped, requires authorisation, resolves the caller from the token
/// subject, serialises the <see cref="AccountView"/> the Application handler already returns, and
/// translates a missing user through the existing <see cref="AuthErrorResults"/> mapping.
/// <para>
/// The host is booted through <see cref="AuthApiFactory"/> with only the two read gateways the use
/// case touches substituted, so no database is required: nothing that shapes the response — the
/// route, the bearer pipeline, the real handler, the configured serialiser, or the error seam — is
/// stubbed.
/// </para>
/// <para>Validates: Requirements 8.1, 8.6, 1.1.</para>
/// </summary>
public sealed class AccountEndpointIntegrationTests : IClassFixture<AuthApiFactory>
{
    private const string AccountRoute = "/auth/me";

    private readonly StubbedAccountUserRepository _users = new();
    private readonly StubbedAccountIdentityRepository _identities = new();
    private readonly HttpClient _client;
    private readonly JsonSerializerOptions _options;

    /// <summary>
    /// Boots the Api once for the class, substituting the user and auth-identity read gateways, and
    /// resolves the JSON options from that same host so expectations are read through the
    /// registration the endpoint actually serialises with.
    /// </summary>
    /// <param name="factory">The shared in-memory Api host factory.</param>
    public AccountEndpointIntegrationTests(AuthApiFactory factory)
    {
        ArgumentNullException.ThrowIfNull(factory);

        WebApplicationFactory<Program> host = factory.WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<IUserRepository>();
                services.AddSingleton<IUserRepository>(_users);
                services.RemoveAll<IAuthIdentityRepository>();
                services.AddSingleton<IAuthIdentityRepository>(_identities);
            }));

        _client = host.CreateClient();
        _options = host.Services.GetRequiredService<IOptions<HttpJsonOptions>>().Value.SerializerOptions;
    }

    // Requirements 8.1, 1.1 — an authenticated caller whose user record exists gets 200 with their
    // own account body: the profile, and one entry per linked identity carrying the identity id that
    // DELETE /auth/identities/{identityId} accepts.
    [Fact]
    public async Task AuthenticatedCaller_ReadsTheirOwnAccount()
    {
        User user = SeedCaller();
        AuthIdentity password = SeedIdentity(
            AuthIdentity.ForPassword(user.Id, user.Email, PasswordCredential.Create("hash-not-a-secret")),
            AuthApiTestConfig.FixedNow.AddDays(-30));
        AuthIdentity google = SeedIdentity(
            AuthIdentity.ForExternal(user.Id, AuthProvider.Google, "google-subject-value"),
            AuthApiTestConfig.FixedNow.AddDays(-1));

        using HttpResponseMessage response = await SendAsync(TestAccessTokens.ValidToken(user.Id));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        string body = await response.Content.ReadAsStringAsync();
        AccountView? view = JsonSerializer.Deserialize<AccountView>(body, _options);

        Assert.NotNull(view);
        Assert.Equal(user.Id, view!.UserId);
        Assert.Equal(user.DisplayName, view.DisplayName);
        Assert.Equal(user.Email, view.Email);
        Assert.True(view.EmailVerified);
        Assert.Equal(user.AvatarReference, view.AvatarReference);

        // One entry per linked identity, in the handler's deterministic linked-instant order, each
        // carrying the persisted AuthIdentity.Id.
        Assert.Equal(
            new[] { password.Id, google.Id },
            view.LinkedIdentities.Select(identity => identity.IdentityId).ToArray());
        Assert.Equal(
            new[] { AuthProvider.Password, AuthProvider.Google },
            view.LinkedIdentities.Select(identity => identity.Provider).ToArray());

        // The caller's own identities only, and the enum crosses the wire as its name (task 1.1), so
        // the body a client reads is the declared contract rather than a numeric code.
        Assert.Equal(new[] { user.Id }, _identities.ListCalls.ToArray());
        Assert.Contains("\"Password\"", body, StringComparison.Ordinal);

        // Nothing resolving reaches the wire: no provider subject and no credential material.
        Assert.DoesNotContain("google-subject-value", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("hash-not-a-secret", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("providerUserId", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("passwordHash", body, StringComparison.OrdinalIgnoreCase);
    }

    // Requirement 8.1 — the endpoint requires authorisation, so an anonymous request never reaches
    // the handler.
    [Fact]
    public async Task AnonymousRequest_IsRefusedWithoutReachingTheHandler()
    {
        User user = SeedCaller();
        SeedIdentity(
            AuthIdentity.ForExternal(user.Id, AuthProvider.Google, "google-subject-value"),
            AuthApiTestConfig.FixedNow.AddDays(-1));

        using HttpResponseMessage response = await SendAsync(bearerToken: null);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Empty(_users.ReadIds);
        Assert.Empty(_identities.ListCalls);
    }

    // Requirement 8.6 — a caller whose user record does not exist keeps the auth seam's existing
    // UserNotFound mapping: 404 with the branchable problem code.
    [Fact]
    public async Task UnknownUser_KeepsTheExistingUserNotFoundMapping()
    {
        // No user seeded, so the caller's token subject resolves to no user record.
        using HttpResponseMessage response = await SendAsync(TestAccessTokens.ValidToken(Guid.CreateVersion7()));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);

        using JsonDocument document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.True(document.RootElement.TryGetProperty("code", out JsonElement code));
        Assert.Equal(AuthErrorCode.UserNotFound.ToString(), code.GetString());
    }

    private User SeedCaller()
    {
        var user = User.Create(
            "Account Read Caller",
            "account-read@example.com",
            emailVerified: true,
            avatarReference: "avatars/account-read.png");

        // The token is minted for this user's own generated id, so the caller the endpoint resolves
        // from the token subject is exactly the seeded user.
        _users.User = user;
        return user;
    }

    private AuthIdentity SeedIdentity(AuthIdentity identity, DateTimeOffset linkedAt)
    {
        identity.CreatedAt = linkedAt;
        _identities.Identities.Add(identity);
        return identity;
    }

    private async Task<HttpResponseMessage> SendAsync(string? bearerToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, AccountRoute);
        if (bearerToken is not null)
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearerToken);
        }

        return await _client.SendAsync(request);
    }
}

/// <summary>
/// The one user the account read can resolve, recording the ids it was asked for so an
/// unauthenticated request can be shown never to have reached the handler.
/// </summary>
internal sealed class StubbedAccountUserRepository : IUserRepository
{
    /// <summary>The seeded user, or <see langword="null"/> to model a caller with no user record.</summary>
    public User? User { get; set; }

    /// <summary>The user ids this gateway was asked for, in call order.</summary>
    public List<Guid> ReadIds { get; } = [];

    public Task<User?> GetByIdAsync(Guid id, CancellationToken ct)
    {
        ReadIds.Add(id);
        return Task.FromResult(User is not null && User.Id == id ? User : null);
    }

    public Task AddAsync(User user, CancellationToken ct) =>
        throw new NotSupportedException("The account read mutates no state.");
}

/// <summary>
/// The caller's linked identities, returned in seed order rather than the order the view presents
/// them, so the endpoint's ordering is measured rather than inherited from this stub.
/// </summary>
internal sealed class StubbedAccountIdentityRepository : IAuthIdentityRepository
{
    /// <summary>The seeded identities, in seed order.</summary>
    public List<AuthIdentity> Identities { get; } = [];

    /// <summary>The user ids the listing was asked for, in call order.</summary>
    public List<Guid> ListCalls { get; } = [];

    public Task<IReadOnlyList<AuthIdentity>> ListForUserAsync(Guid userId, CancellationToken ct)
    {
        ListCalls.Add(userId);
        IReadOnlyList<AuthIdentity> owned = Identities.Where(identity => identity.UserId == userId).ToList();
        return Task.FromResult(owned);
    }

    public Task<AuthIdentity?> FindByProviderKeyAsync(
        AuthProvider provider, string providerUserId, CancellationToken ct) =>
        throw new NotSupportedException("Provider-key resolution is not exercised by the account read.");

    public Task AddAsync(AuthIdentity identity, CancellationToken ct) =>
        throw new NotSupportedException("The account read mutates no state.");

    public void Remove(AuthIdentity identity) =>
        throw new NotSupportedException("The account read mutates no state.");
}
