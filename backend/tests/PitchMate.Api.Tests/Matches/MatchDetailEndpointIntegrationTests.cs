using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using PitchMate.Api.Tests.Auth;
using PitchMate.Application.Matches.UseCases;
using PitchMate.Domain.Auth;
using PitchMate.Domain.Matches;
using PitchMate.Domain.Squads;
using PitchMate.Infrastructure.Persistence;

namespace PitchMate.Api.Tests.Matches;

/// <summary>
/// Api-level tests for <c>GET /matches/{matchId}</c> (match-read-models task 10.8), driven through the
/// application's <b>real request pipeline</b> against a throwaway PostgreSQL container.
/// <list type="bullet">
/// <item>An admitted caller receives <c>200 OK</c> carrying the declared <see cref="MatchDetail"/>
/// contract, every member present, with the squad resolved from the match and the caller's own
/// availability (Requirement 2.1).</item>
/// <item>A refused caller receives the concealing <c>404</c>, byte-for-byte identical to the shipped
/// team-sheet read's refusal (Requirements 5.6, 5.7, 13.17).</item>
/// <item>Every token condition is <c>401</c>, never the concealed <c>404</c>.</item>
/// <item>A malformed <c>{matchId}</c> fails the <c>:guid</c> route constraint, so <b>routing</b>
/// answers <c>404</c> with an <b>empty body</b> before the endpoint runs (Requirement 2.14). That is
/// deliberately <b>not</b> compared with the concealed body, which carries a <c>ProblemDetails</c> — the
/// two are both "no detail, no code", not byte-identical, and Property 14 (task 14.3) excludes this case
/// for the same reason.</item>
/// </list>
/// <para>Validates: Requirements 2.1, 2.14, 5.12, 13.17.</para>
/// </summary>
public sealed class MatchDetailEndpointIntegrationTests : IClassFixture<RoutingApiFactory>
{
    private const string InvalidBearerToken = "not-a-real.jwt.token";

    private const string Location = "Mabley Green";

    /// <summary>Every member <see cref="MatchDetail"/> declares, as the response body names them.</summary>
    private static readonly string[] DetailMemberNames =
    [
        "matchId",
        "squadId",
        "state",
        "location",
        "candidateDays",
        "confirmedDay",
        "participantCount",
        "participants",
        "callerIsParticipant",
        "callerAvailability",
        "recordedResult",
        "completedAt",
        "guestAvailability",
    ];

    private readonly RoutingApiFactory _factory;

    /// <summary>Receives the shared, container-backed Api host factory.</summary>
    public MatchDetailEndpointIntegrationTests(RoutingApiFactory factory)
    {
        _factory = factory;
    }

    /// <summary>The three token conditions that must each be answered <c>401</c>.</summary>
    public enum TokenCondition
    {
        /// <summary>No <c>Authorization</c> header at all.</summary>
        NoToken,

        /// <summary>A bearer value the JWT pipeline rejects.</summary>
        RejectedToken,

        /// <summary>A token the pipeline accepts, carrying no <c>sub</c> claim.</summary>
        AcceptedTokenWithNoSubject,
    }

    /// <summary>The three token conditions as theory data.</summary>
    public static TheoryData<TokenCondition> TokenConditions() => new()
    {
        TokenCondition.NoToken,
        TokenCondition.RejectedToken,
        TokenCondition.AcceptedTokenWithNoSubject,
    };

    [Fact]
    public async Task GetMatchDetail_ByActiveMember_Returns200AndTheDeclaredContract()
    {
        SeededDetailWorld world = await SeedAsync();
        using HttpClient client = CreateClient();

        using HttpResponseMessage response =
            await SendRawAsync(client, $"/matches/{world.MatchId}", _factory.CreateAccessToken(world.MemberUserId));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        using JsonDocument document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        JsonElement detail = document.RootElement;

        Assert.Equal(
            DetailMemberNames.ToHashSet(StringComparer.Ordinal),
            detail.EnumerateObject().Select(static member => member.Name).ToHashSet(StringComparer.Ordinal));

        Assert.Equal(world.MatchId, detail.GetProperty("matchId").GetGuid());
        Assert.Equal(world.SquadId, detail.GetProperty("squadId").GetGuid());
        Assert.Equal(nameof(MatchState.GatheringAvailability), detail.GetProperty("state").GetString());
        Assert.Equal(Location, detail.GetProperty("location").GetString());
        Assert.Equal(2, detail.GetProperty("candidateDays").GetArrayLength());
        Assert.Equal(JsonValueKind.Null, detail.GetProperty("confirmedDay").ValueKind);
        Assert.Equal(0, detail.GetProperty("participantCount").GetInt32());
        Assert.Equal(0, detail.GetProperty("participants").GetArrayLength());
        Assert.False(detail.GetProperty("callerIsParticipant").GetBoolean());
        Assert.Equal(JsonValueKind.Null, detail.GetProperty("recordedResult").ValueKind);
        Assert.Equal(JsonValueKind.Null, detail.GetProperty("completedAt").ValueKind);

        // The caller stored a response marking no day: both members present, true and empty.
        JsonElement caller = detail.GetProperty("callerAvailability");
        Assert.Equal(
            new HashSet<string>(StringComparer.Ordinal) { "hasStoredResponse", "markedDays" },
            caller.EnumerateObject().Select(static member => member.Name).ToHashSet(StringComparer.Ordinal));
        Assert.True(caller.GetProperty("hasStoredResponse").GetBoolean());
        Assert.Equal(0, caller.GetProperty("markedDays").GetArrayLength());
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task GetMatchDetail_ByRefusedCaller_ReturnsTheConcealedNotFound(bool matchExists)
    {
        SeededDetailWorld world = await SeedAsync();
        using HttpClient client = CreateClient();

        Guid matchId = matchExists ? world.MatchId : Guid.NewGuid();
        string token = _factory.CreateAccessToken(world.StrangerUserId);

        using HttpResponseMessage refusal = await SendRawAsync(client, $"/matches/{matchId}", token);

        Assert.Equal(HttpStatusCode.NotFound, refusal.StatusCode);
        byte[] refusalBody = await refusal.Content.ReadAsByteArrayAsync();

        using HttpResponseMessage teamSheetRefusal =
            await SendRawAsync(client, $"/matches/{Guid.NewGuid()}/team-sheet", token);

        Assert.Equal(HttpStatusCode.NotFound, teamSheetRefusal.StatusCode);
        Assert.Equal(await teamSheetRefusal.Content.ReadAsByteArrayAsync(), refusalBody);

        using JsonDocument problem = JsonDocument.Parse(refusalBody);
        Assert.False(problem.RootElement.TryGetProperty("code", out _));
    }

    [Theory]
    [MemberData(nameof(TokenConditions))]
    public async Task GetMatchDetail_UnderEveryTokenCondition_Returns401AndNotTheConcealed404(TokenCondition condition)
    {
        SeededDetailWorld world = await SeedAsync();
        using HttpClient client = CreateClient();

        using HttpResponseMessage response = await SendRawAsync(client, $"/matches/{world.MatchId}", TokenFor(condition));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);

        using JsonDocument problem = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(401, problem.RootElement.GetProperty("status").GetInt32());

        // Only the subjectless token reaches the endpoint, whose own Unauthenticated() carries no code.
        Assert.Equal(
            condition == TokenCondition.AcceptedTokenWithNoSubject,
            !problem.RootElement.TryGetProperty("code", out _));
    }

    // Requirement 2.14 — answered by routing, with an empty body. Not compared with the concealed body.
    [Theory]
    [InlineData("not-a-guid")]
    [InlineData("12345")]
    public async Task GetMatchDetail_WithAMalformedMatchId_Returns404WithAnEmptyBody(string malformed)
    {
        SeededDetailWorld world = await SeedAsync();
        using HttpClient client = CreateClient();

        using HttpResponseMessage response =
            await SendRawAsync(client, $"/matches/{malformed}", _factory.CreateAccessToken(world.MemberUserId));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Empty(await response.Content.ReadAsByteArrayAsync());
    }

    private string? TokenFor(TokenCondition condition) => condition switch
    {
        TokenCondition.NoToken => null,
        TokenCondition.RejectedToken => InvalidBearerToken,
        TokenCondition.AcceptedTokenWithNoSubject => _factory.CreateAccessTokenWithoutSubject(),
        _ => throw new ArgumentOutOfRangeException(nameof(condition), condition, "Unhandled token condition."),
    };

    private static async Task<HttpResponseMessage> SendRawAsync(HttpClient client, string path, string? token)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, path);

        if (token is not null)
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        }

        return await client.SendAsync(request);
    }

    private HttpClient CreateClient() =>
        _factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

    /// <summary>
    /// Seeds a fresh squad with one active owner, a draft match on which the owner stored a response
    /// marking no day, and a user holding no membership anywhere, through the host's own context.
    /// </summary>
    private async Task<SeededDetailWorld> SeedAsync()
    {
        using IServiceScope scope = _factory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<PitchMateDbContext>();

        DateTimeOffset now = _factory.Clock.GetUtcNow();

        Squad squad = Squad.Create("Match Detail Squad").Value!;
        User member = User.Create("Detail Member", UniqueEmail(), emailVerified: true);
        User stranger = User.Create("Detail Stranger", UniqueEmail(), emailVerified: true);
        SquadMembership membership = SquadMembership.CreateOwner(squad.Id, member.Id, "Detail Member").Value!;

        Match match = Match.CreateDraft(
            Guid.CreateVersion7(), squad.Id, Location, [now.AddDays(7), now.AddDays(14)], now).Value!;
        AvailabilityResponse response = match.SubmitAvailability(membership.Id, [], now).Value!;

        db.AddRange(squad, member, stranger, membership, match, response);
        await db.SaveChangesAsync();

        return new SeededDetailWorld(squad.Id, member.Id, stranger.Id, match.Id);
    }

    private static string UniqueEmail() => $"match-detail-{Guid.NewGuid():N}@example.com";

    /// <summary>The identities one seeded world exposes to a test.</summary>
    private sealed record SeededDetailWorld(Guid SquadId, Guid MemberUserId, Guid StrangerUserId, Guid MatchId);
}
