using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PitchMate.Api.Tests.Auth;
using PitchMate.Domain.Auth;
using PitchMate.Domain.Notifications;
using PitchMate.Domain.Squads;
using PitchMate.Infrastructure.Persistence;

namespace PitchMate.Api.Tests.Notifications;

/// <summary>
/// Integration tests over the real Api host asserting the authorisation contract of the notification
/// read-model endpoints end-to-end through the actual JWT bearer pipeline, EF Core persistence, and
/// endpoint mappings (booted against a throwaway PostgreSQL container via <see cref="RoutingApiFactory"/>):
/// <list type="bullet">
/// <item>Every read-model endpoint requires authentication: an anonymous or invalid-token request is
/// rejected with <c>401</c> before any handler runs (Requirement 10.2).</item>
/// <item>The read model is own-records-only: a caller sees, counts, and can mark read only their own
/// records; another user's records are invisible and untouchable (Requirements 10.1, 10.4, 10.6).</item>
/// <item>Not-found is non-disclosing: marking a foreign or non-existent record, and any squad-scoped
/// request over a squad the caller has no membership in, all return the same uniform <c>404</c> — never
/// <c>403</c> and never revealing whether the record or squad exists (Requirements 10.1, 10.3, 10.5).</item>
/// </list>
/// <para>Validates: Requirements 10.1, 10.2, 10.3.</para>
/// </summary>
public sealed class NotificationEndpointIntegrationTests : IClassFixture<RoutingApiFactory>
{
    private const string InvalidBearerToken = "not-a-real.jwt.token";

    private readonly RoutingApiFactory _factory;

    /// <summary>Receives the shared, container-backed Api host factory.</summary>
    /// <param name="factory">The Api host factory booting against a throwaway PostgreSQL container.</param>
    public NotificationEndpointIntegrationTests(RoutingApiFactory factory)
    {
        _factory = factory;
    }

    // Requirement 10.2 — every notification read-model endpoint is protected. An anonymous or an
    // invalid-token request is rejected with the uniform 401 by the JWT bearer middleware before any
    // handler (and thus any persistence access) runs.
    public static TheoryData<string, string> ProtectedEndpoints() => new()
    {
        { "GET", "/notifications" },
        { "GET", "/notifications?squadId=" + Guid.NewGuid() },
        { "GET", "/notifications/unread-count" },
        { "GET", "/notifications/unread-count?squadId=" + Guid.NewGuid() },
        { "POST", $"/notifications/{Guid.NewGuid()}/read" },
        { "POST", "/notifications/read-all" },
        { "POST", "/notifications/read-all?squadId=" + Guid.NewGuid() },
    };

    [Theory]
    [MemberData(nameof(ProtectedEndpoints))]
    public async Task Endpoint_WithoutToken_Returns401(string method, string path)
    {
        using HttpClient client = CreateClient();

        using HttpResponseMessage response =
            await SendAsync(client, new HttpMethod(method), path, bearerToken: null);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Theory]
    [MemberData(nameof(ProtectedEndpoints))]
    public async Task Endpoint_WithInvalidToken_Returns401(string method, string path)
    {
        using HttpClient client = CreateClient();

        using HttpResponseMessage response =
            await SendAsync(client, new HttpMethod(method), path, InvalidBearerToken);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // Requirements 10.1, 10.4, 10.6 — own-records-only enforcement. A record owned by user A is
    // invisible to a different authenticated user B: B's listing is empty and B's unread count is zero,
    // even though the record exists in the same store.
    [Fact]
    public async Task List_And_Count_ExposeOnlyTheCallersOwnRecords()
    {
        SeededNotification seeded = await SeedOwnedNotificationAsync();
        Guid otherUserId = await SeedUserAsync();

        using HttpClient client = CreateClient();

        // The owner (user A) sees exactly their one record and counts it as unread.
        IReadOnlyList<Guid> ownerRecords = await ListNotificationIdsAsync(client, seeded.UserId);
        Assert.Equal(new[] { seeded.NotificationId }, ownerRecords);
        Assert.Equal(1, await UnreadCountAsync(client, seeded.UserId));

        // A different authenticated user (user B) sees nothing and counts zero — A's record is not theirs.
        Assert.Empty(await ListNotificationIdsAsync(client, otherUserId));
        Assert.Equal(0, await UnreadCountAsync(client, otherUserId));
    }

    // Requirement 10.1 — the happy path: a caller can list their own record, mark it read (204), and the
    // unread count then reflects the change, with the record recorded as Read in the store.
    [Fact]
    public async Task Owner_CanMarkOwnRecordRead_AndCountReflectsIt()
    {
        SeededNotification seeded = await SeedOwnedNotificationAsync();

        using HttpClient client = CreateClient();

        Assert.Equal(1, await UnreadCountAsync(client, seeded.UserId));

        using HttpResponseMessage markResponse = await SendAsync(
            client,
            HttpMethod.Post,
            $"/notifications/{seeded.NotificationId}/read",
            _factory.CreateAccessToken(seeded.UserId));

        Assert.Equal(HttpStatusCode.NoContent, markResponse.StatusCode);

        // The count drops to zero and the record is persisted as Read.
        Assert.Equal(0, await UnreadCountAsync(client, seeded.UserId));
        Assert.Equal(ReadState.Read, await GetReadStateAsync(seeded.NotificationId));
    }

    // Requirements 10.1, 10.3, 10.5 — a caller marking another user's record read gets the uniform,
    // non-disclosing 404 (never 403), and the foreign record is left Unread in the store: the caller can
    // neither observe nor alter a record that is not theirs.
    [Fact]
    public async Task MarkRead_OfForeignRecord_Returns404_AndLeavesItUnread()
    {
        SeededNotification seeded = await SeedOwnedNotificationAsync();
        Guid otherUserId = await SeedUserAsync();

        using HttpClient client = CreateClient();

        using HttpResponseMessage response = await SendAsync(
            client,
            HttpMethod.Post,
            $"/notifications/{seeded.NotificationId}/read",
            _factory.CreateAccessToken(otherUserId));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.NotEqual(HttpStatusCode.Forbidden, response.StatusCode);

        // The foreign attempt changed nothing: user A's record is still Unread.
        Assert.Equal(ReadState.Unread, await GetReadStateAsync(seeded.NotificationId));
    }

    // Requirements 10.1, 10.3, 10.5 — marking a record that does not exist at all is indistinguishable
    // from marking one that is simply not the caller's: both return the same uniform 404.
    [Fact]
    public async Task MarkRead_OfNonExistentRecord_Returns404()
    {
        Guid userId = await SeedUserAsync();

        using HttpClient client = CreateClient();

        using HttpResponseMessage response = await SendAsync(
            client,
            HttpMethod.Post,
            $"/notifications/{Guid.NewGuid()}/read",
            _factory.CreateAccessToken(userId));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.NotEqual(HttpStatusCode.Forbidden, response.StatusCode);
    }

    // Requirements 10.3, 10.5 — a squad-scoped request over a squad the caller has no membership in is
    // rejected with the uniform 404 (never 403), whether the squad is a genuine one the caller cannot see
    // or a non-existent id. This covers list, unread-count, and mark-all-read.
    public static TheoryData<string, string> SquadScopedEndpoints() => new()
    {
        { "GET", "/notifications?squadId={0}" },
        { "GET", "/notifications/unread-count?squadId={0}" },
        { "POST", "/notifications/read-all?squadId={0}" },
    };

    [Theory]
    [MemberData(nameof(SquadScopedEndpoints))]
    public async Task SquadScopedRequest_ForForeignSquad_Returns404(string method, string pathTemplate)
    {
        // A genuine squad exists (owned by user A); the caller (user B) holds no membership in it.
        SeededNotification seeded = await SeedOwnedNotificationAsync();
        Guid outsiderUserId = await SeedUserAsync();

        using HttpClient client = CreateClient();

        string path = string.Format(pathTemplate, seeded.SquadId);
        using HttpResponseMessage response = await SendAsync(
            client, new HttpMethod(method), path, _factory.CreateAccessToken(outsiderUserId));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.NotEqual(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Theory]
    [MemberData(nameof(SquadScopedEndpoints))]
    public async Task SquadScopedRequest_ForNonExistentSquad_Returns404(string method, string pathTemplate)
    {
        Guid userId = await SeedUserAsync();

        using HttpClient client = CreateClient();

        string path = string.Format(pathTemplate, Guid.NewGuid());
        using HttpResponseMessage response = await SendAsync(
            client, new HttpMethod(method), path, _factory.CreateAccessToken(userId));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.NotEqual(HttpStatusCode.Forbidden, response.StatusCode);
    }

    // --- Seeding helpers (via the running host's DI + real DbContext) ---

    /// <summary>
    /// Seeds a registered user, a squad they own, and one <c>Unread</c> in-app notification directed to
    /// that user's membership, returning the ids the tests act on.
    /// </summary>
    private async Task<SeededNotification> SeedOwnedNotificationAsync()
    {
        using IServiceScope scope = _factory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<PitchMateDbContext>();

        User user = User.Create("Owner User", UniqueEmail(), emailVerified: true);
        Squad squad = Squad.Create("Test Squad").Value!;
        SquadMembership membership = SquadMembership.CreateOwner(squad.Id, user.Id, "Owner").Value!;
        InAppNotification notification = InAppNotification.Create(
            squad.Id, membership.Id, NotificationType.MemberJoined, "You have a notification", "Something happened.").Value!;

        db.Add(user);
        db.Add(squad);
        db.Add(membership);
        db.Add(notification);
        await db.SaveChangesAsync();

        return new SeededNotification(user.Id, squad.Id, membership.Id, notification.Id);
    }

    /// <summary>Seeds a bare registered user (no squad membership) and returns their id.</summary>
    private async Task<Guid> SeedUserAsync()
    {
        using IServiceScope scope = _factory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<PitchMateDbContext>();

        User user = User.Create("Bystander User", UniqueEmail(), emailVerified: true);
        db.Add(user);
        await db.SaveChangesAsync();

        return user.Id;
    }

    /// <summary>Reads a notification's persisted <see cref="ReadState"/> in a fresh context.</summary>
    private async Task<ReadState> GetReadStateAsync(Guid notificationId)
    {
        using IServiceScope scope = _factory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<PitchMateDbContext>();

        InAppNotification record = await db.Set<InAppNotification>()
            .AsNoTracking()
            .SingleAsync(n => n.Id == notificationId);

        return record.ReadState;
    }

    // --- HTTP helpers ---

    private async Task<IReadOnlyList<Guid>> ListNotificationIdsAsync(HttpClient client, Guid userId)
    {
        using HttpResponseMessage response =
            await SendAsync(client, HttpMethod.Get, "/notifications", _factory.CreateAccessToken(userId));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        string payload = await response.Content.ReadAsStringAsync();
        using JsonDocument document = JsonDocument.Parse(payload);

        Assert.Equal(JsonValueKind.Array, document.RootElement.ValueKind);

        return document.RootElement
            .EnumerateArray()
            .Select(element => element.GetProperty("notificationId").GetGuid())
            .ToList();
    }

    private async Task<int> UnreadCountAsync(HttpClient client, Guid userId)
    {
        using HttpResponseMessage response = await SendAsync(
            client, HttpMethod.Get, "/notifications/unread-count", _factory.CreateAccessToken(userId));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return await response.Content.ReadFromJsonAsync<int>();
    }

    private static string UniqueEmail() => $"user-{Guid.NewGuid():N}@example.com";

    private HttpClient CreateClient() =>
        _factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

    private static async Task<HttpResponseMessage> SendAsync(
        HttpClient client, HttpMethod method, string path, string? bearerToken)
    {
        var request = new HttpRequestMessage(method, path);
        if (bearerToken is not null)
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearerToken);
        }

        return await client.SendAsync(request);
    }

    /// <summary>The ids produced by <see cref="SeedOwnedNotificationAsync"/>.</summary>
    private sealed record SeededNotification(Guid UserId, Guid SquadId, Guid MembershipId, Guid NotificationId);
}
