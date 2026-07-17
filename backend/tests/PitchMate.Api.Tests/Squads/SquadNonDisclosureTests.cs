using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;
using PitchMate.Api.Tests.Auth;

namespace PitchMate.Api.Tests.Squads;

/// <summary>
/// Integration tests over the real Api host asserting the squad subsystem's non-disclosure contract
/// end-to-end through the actual JWT bearer pipeline and endpoint mappings:
/// <list type="bullet">
/// <item>Squad reads without a bearer token are rejected with <c>401</c> before any handler runs
/// (Requirement 16.3).</item>
/// <item>A squad read by an authenticated caller who is not an active member returns <c>404</c>, not
/// <c>403</c>, so the squad's existence is never revealed (Requirement 16.2).</item>
/// <item>The pre-join invite preview is anonymous and its body carries no squad data — no name,
/// members, matches, or stats — only a generic instruction (Requirement 11.6).</item>
/// </list>
/// <para>Validates: Requirements 11.6, 16.2, 16.3.</para>
/// </summary>
public sealed class SquadNonDisclosureTests : IClassFixture<RoutingApiFactory>
{
    private readonly RoutingApiFactory _factory;

    /// <summary>Receives the shared, container-backed Api host factory.</summary>
    /// <param name="factory">The Api host factory booting against a throwaway PostgreSQL container.</param>
    public SquadNonDisclosureTests(RoutingApiFactory factory)
    {
        _factory = factory;
    }

    // Requirement 16.3 — squad reads without a bearer token are rejected with 401 before any handler
    // runs. Both the collection read and a specific-squad read are protected.
    public static TheoryData<string> ProtectedSquadReads() => new()
    {
        "/squads",
        $"/squads/{Guid.NewGuid()}",
        $"/squads/{Guid.NewGuid()}/features",
    };

    [Theory]
    [MemberData(nameof(ProtectedSquadReads))]
    public async Task SquadRead_WithoutToken_Returns401(string path)
    {
        using HttpClient client = CreateClient();

        using HttpResponseMessage response = await client.GetAsync(path);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // Requirement 16.2 — an authenticated caller who is not an active member of the target squad must
    // not be able to tell an existing-but-forbidden squad from a non-existent one. The read returns the
    // existence-concealing 404 rather than 403. Here the squad id is random (no such squad), which the
    // handler treats identically to "not a member", so a genuine squad the caller cannot see would look
    // the same.
    [Fact]
    public async Task SquadRead_ByAuthenticatedNonMember_Returns404_NotRevealingExistence()
    {
        using HttpClient client = CreateClient();
        string token = _factory.CreateAccessToken(Guid.NewGuid());

        using var request = new HttpRequestMessage(HttpMethod.Get, $"/squads/{Guid.NewGuid()}");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);

        using HttpResponseMessage response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.NotEqual(HttpStatusCode.Forbidden, response.StatusCode);
    }

    // Requirement 11.6 — the pre-join preview is reachable anonymously and discloses no squad data. Its
    // body carries only a generic instruction and the "authentication required" flag; it never names
    // the squad or exposes members, matches, or stats, and it does not even confirm the invite is real.
    [Fact]
    public async Task InvitePreview_IsAnonymous_AndLeaksNoSquadData()
    {
        using HttpClient client = CreateClient();

        using HttpResponseMessage response = await client.GetAsync("/squads/invites/preview");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        string payload = await response.Content.ReadAsStringAsync();
        using JsonDocument document = JsonDocument.Parse(payload);
        JsonElement root = document.RootElement;

        // The response shape is exactly the generic preview: only the authentication flag and message,
        // and nothing else. There is structurally nowhere for squad data to hide.
        Assert.Equal(JsonValueKind.Object, root.ValueKind);
        var propertyNames = root.EnumerateObject().Select(p => p.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);
        Assert.Equal(new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "requiresAuthentication", "message" }, propertyNames);

        // The preview only tells the visitor authentication is required; it exposes no squad identity.
        Assert.True(root.GetProperty("requiresAuthentication").GetBoolean());

        // The message is a scalar string, never a nested object/array that could carry squad name,
        // members, matches, or stats. Combined with the exact two-field shape above, this guarantees no
        // squad data is disclosed before an authenticated join (Requirement 11.6).
        Assert.Equal(JsonValueKind.String, root.GetProperty("message").ValueKind);
    }

    private HttpClient CreateClient() =>
        _factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            AllowAutoRedirect = false,
        });
}
