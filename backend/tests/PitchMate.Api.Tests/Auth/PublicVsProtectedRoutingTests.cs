using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PitchMate.Application.Auth;
using PitchMate.Domain.Auth;
using PitchMate.Infrastructure.Persistence;

namespace PitchMate.Api.Tests.Auth;

/// <summary>
/// Integration tests over the real Api host asserting the public-versus-protected routing contract of
/// Requirement 13:
/// <list type="bullet">
/// <item>Every endpoint the spec lists as public — register, sign-in, Google sign-in, refresh,
/// password-reset request/redeem, and email-verification redeem — is reachable without an access token
/// (Requirement 13.6): it reaches its handler and returns a validation/domain response rather than the
/// authentication challenge.</item>
/// <item>Every protected endpoint refuses both an anonymous request and one bearing an invalid access
/// token with a uniform <c>401</c> (Requirements 13.3, 13.4) and changes no persisted state, because the
/// challenge short-circuits before the handler runs.</item>
/// </list>
/// <para>Validates: Requirements 13.3, 13.4, 13.6.</para>
/// </summary>
public sealed class PublicVsProtectedRoutingTests : IClassFixture<RoutingApiFactory>
{
    private const string InvalidBearerToken = "not-a-real.jwt.token";

    private readonly RoutingApiFactory _factory;

    /// <summary>Receives the shared, container-backed Api host factory.</summary>
    /// <param name="factory">The Api host factory booting against a throwaway PostgreSQL container.</param>
    public PublicVsProtectedRoutingTests(RoutingApiFactory factory)
    {
        _factory = factory;
    }

    // Requirement 13.6 — each public endpoint is reachable without a prior access token. We send an
    // anonymous request with a minimal/deliberately-invalid body: reaching the handler yields a
    // validation or domain response (any status other than 401), which proves anonymous access was not
    // blocked by the authentication pipeline.
    public static TheoryData<string, HttpMethod, object?> PublicEndpoints() => new()
    {
        { "/auth/register", HttpMethod.Post, new { email = (string?)null, password = (string?)null } },
        { "/auth/sign-in", HttpMethod.Post, new { email = (string?)null, password = (string?)null } },
        { "/auth/sign-in/google", HttpMethod.Post, new { assertion = (string?)null } },
        { "/auth/refresh", HttpMethod.Post, new { refreshToken = (string?)null } },
        { "/auth/password-reset/request", HttpMethod.Post, new { email = "someone@example.com" } },
        { "/auth/password-reset/redeem", HttpMethod.Post, new { token = "bogus-token", newPassword = "too-short" } },
        { "/auth/email/verification/redeem", HttpMethod.Post, new { token = "bogus-token" } },
    };

    [Theory]
    [MemberData(nameof(PublicEndpoints))]
    public async Task PublicEndpoint_IsReachableAnonymously(string path, HttpMethod method, object? body)
    {
        using HttpClient client = CreateClient();

        using var request = new HttpRequestMessage(method, path);
        if (body is not null)
        {
            request.Content = JsonContent.Create(body);
        }

        using HttpResponseMessage response = await client.SendAsync(request);

        // The endpoint is public when the anonymous request is not blocked by the authentication
        // challenge (Requirement 13.6). It may still return a domain 401 for bad credentials (for
        // example an invalid Google assertion) — that is a handler result, distinguished from the
        // bearer middleware's uniform "authentication required" challenge, which never fires on an
        // AllowAnonymous endpoint.
        await AssertNotAuthenticationChallengeAsync(response);
    }

    /// <summary>
    /// Asserts a response is not the bearer middleware's uniform unauthenticated challenge: either it
    /// is not a 401 at all, or it is a domain 401 whose problem <c>code</c> is not
    /// <see cref="AuthErrorCode.Unauthenticated"/> (proving the request reached the handler).
    /// </summary>
    private static async Task AssertNotAuthenticationChallengeAsync(HttpResponseMessage response)
    {
        if (response.StatusCode != HttpStatusCode.Unauthorized)
        {
            return;
        }

        string? code = await ReadProblemCodeAsync(response);
        Assert.NotEqual(AuthErrorCode.Unauthenticated.ToString(), code);
    }

    private static async Task<string?> ReadProblemCodeAsync(HttpResponseMessage response)
    {
        string payload = await response.Content.ReadAsStringAsync();
        if (string.IsNullOrWhiteSpace(payload))
        {
            return null;
        }

        using JsonDocument document = JsonDocument.Parse(payload);
        return document.RootElement.TryGetProperty("code", out JsonElement code)
            ? code.GetString()
            : null;
    }

    // Requirements 13.3, 13.4 — each protected endpoint refuses an anonymous request and one carrying an
    // invalid access token with the uniform 401.
    public static TheoryData<string, HttpMethod, object?> ProtectedEndpoints() => new()
    {
        { "/auth/sign-out", HttpMethod.Post, new { refreshToken = "bogus-token" } },
        { "/auth/identities/external", HttpMethod.Post, new { provider = "Google", assertion = "bogus" } },
        { "/auth/identities/password", HttpMethod.Post, new { password = "some-password-value" } },
        { $"/auth/identities/{Guid.NewGuid()}", HttpMethod.Delete, null },
        { "/auth/email/verification/request", HttpMethod.Post, null },
        { "/auth/erasure", HttpMethod.Post, null },
        { "/auth/export", HttpMethod.Get, null },
    };

    [Theory]
    [MemberData(nameof(ProtectedEndpoints))]
    public async Task ProtectedEndpoint_RejectsAnonymousRequest(string path, HttpMethod method, object? body)
    {
        using HttpClient client = CreateClient();

        using HttpResponseMessage response = await SendAsync(client, method, path, body, bearerToken: null);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Theory]
    [MemberData(nameof(ProtectedEndpoints))]
    public async Task ProtectedEndpoint_RejectsInvalidToken(string path, HttpMethod method, object? body)
    {
        using HttpClient client = CreateClient();

        using HttpResponseMessage response = await SendAsync(client, method, path, body, InvalidBearerToken);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // Requirements 13.3, 13.4 — an anonymous/invalid request to a protected endpoint changes no persisted
    // state. We seed a user with an active refresh token, fire every protected endpoint both anonymously
    // and with an invalid token, then confirm the seeded state is untouched: the display name and
    // verification flag are unchanged (no erasure ran), and the refresh token is still active (no
    // sign-out/revocation ran).
    [Fact]
    public async Task ProtectedEndpoints_MutateNothing_WhenUnauthenticated()
    {
        Guid userId = await SeedUserWithActiveRefreshTokenAsync();

        using HttpClient client = CreateClient();

        foreach ((string path, HttpMethod method, object? body) in ProtectedRequests())
        {
            using (HttpResponseMessage anonymous = await SendAsync(client, method, path, body, bearerToken: null))
            {
                Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
            }

            using HttpResponseMessage invalid = await SendAsync(client, method, path, body, InvalidBearerToken);
            Assert.Equal(HttpStatusCode.Unauthorized, invalid.StatusCode);
        }

        using IServiceScope scope = _factory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<PitchMateDbContext>();

        User? user = await db.Set<User>().AsNoTracking().SingleOrDefaultAsync(u => u.Id == userId);
        Assert.NotNull(user);
        // No erasure ran: PII is intact and not replaced with the anonymisation placeholder.
        Assert.NotEqual(User.DisplayNamePlaceholder, user!.DisplayName);
        Assert.True(user.EmailVerified);

        RefreshToken? token = await db.Set<RefreshToken>().AsNoTracking()
            .SingleOrDefaultAsync(t => t.UserId == userId);
        Assert.NotNull(token);
        // No sign-out/revocation ran: the token family is still active.
        Assert.Equal(RefreshTokenStatus.Active, token!.Status);
    }

    private static IEnumerable<(string Path, HttpMethod Method, object? Body)> ProtectedRequests()
    {
        yield return ("/auth/sign-out", HttpMethod.Post, new { refreshToken = "bogus-token" });
        yield return ("/auth/identities/external", HttpMethod.Post, new { provider = "Google", assertion = "bogus" });
        yield return ("/auth/identities/password", HttpMethod.Post, new { password = "some-password-value" });
        yield return ($"/auth/identities/{Guid.NewGuid()}", HttpMethod.Delete, null);
        yield return ("/auth/email/verification/request", HttpMethod.Post, null);
        yield return ("/auth/erasure", HttpMethod.Post, null);
        yield return ("/auth/export", HttpMethod.Get, null);
    }

    private async Task<Guid> SeedUserWithActiveRefreshTokenAsync()
    {
        using IServiceScope scope = _factory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<PitchMateDbContext>();

        var user = User.Create("Routing Seed User", "routing-seed@example.com", emailVerified: true);
        DateTimeOffset expiry = _factory.Clock.GetUtcNow().AddDays(30);
        RefreshToken token = RefreshToken.StartFamily(user.Id, "seeded-token-hash", expiry);

        db.Add(user);
        db.Add(token);
        await db.SaveChangesAsync();

        return user.Id;
    }

    private HttpClient CreateClient() =>
        _factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
        });

    private static async Task<HttpResponseMessage> SendAsync(
        HttpClient client, HttpMethod method, string path, object? body, string? bearerToken)
    {
        using var request = new HttpRequestMessage(method, path);
        if (body is not null)
        {
            request.Content = JsonContent.Create(body);
        }

        if (bearerToken is not null)
        {
            request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", bearerToken);
        }

        return await client.SendAsync(request);
    }
}
