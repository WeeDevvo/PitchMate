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
/// Api-level tests for <c>GET /squads/{squadId}/matches</c> (match-read-models task 6.2), driven
/// through the application's <b>real request pipeline</b> — the actual JWT bearer middleware, route
/// matching, endpoint filters, DI graph and EF Core persistence against a throwaway PostgreSQL
/// container. Nothing here constructs a handler or a <c>DbContext</c> by hand, so what is asserted is
/// what a generated client would actually receive.
/// <list type="bullet">
/// <item>An admitted caller — an active member of the squad in the path — receives <c>200 OK</c>
/// carrying the declared <see cref="MatchList"/> contract, with every member of
/// <see cref="MatchListEntry"/> present whatever the match's state (Requirement 1.1, 1.8).</item>
/// <item>A caller the gate refuses receives the concealing <c>404</c>, <b>byte-for-byte identical</b>
/// to the refusal the already-shipped availability tally and team-sheet reads return — which is the
/// point of routing this read through the same argument-free <c>MatchErrorResults.Concealed()</c>
/// (Requirements 5.6, 5.7, 13.17).</item>
/// <item><see cref="MatchState"/> reaches the wire as a <b>member name</b> in a real response body,
/// not as an integer (Requirement 5.12's wire-shape half, pinned here against a live response rather
/// than only against the emitted document).</item>
/// <item>Every token condition is <c>401</c> and explicitly <b>not</b> the concealed <c>404</c>: no
/// token at all, a rejected token, and an accepted token carrying no resolvable subject. The last of
/// those is the only one that reaches the endpoint lambda, so it is the only one that exercises the
/// read's own <c>Unauthenticated()</c> branch.</item>
/// </list>
/// <para>Validates: Requirements 1.1, 5.12, 13.17.</para>
/// <para>Docker is required: the host boots against a PostgreSQL container with the production EF
/// migrations applied, per the project's test-layering standard.</para>
/// </summary>
public sealed class MatchListEndpointIntegrationTests : IClassFixture<RoutingApiFactory>
{
    private const string InvalidBearerToken = "not-a-real.jwt.token";

    private const string Location = "Hackney Marshes, Pitch 12";

    /// <summary>
    /// Every member <see cref="MatchListEntry"/> declares, as the response body names them. Asserted as
    /// an exact set so a member that is omitted on some state — rather than reported as an explicit
    /// <c>null</c> or an empty collection — fails here (Requirement 1.8).
    /// </summary>
    private static readonly string[] EntryMemberNames =
    [
        "matchId",
        "state",
        "location",
        "confirmedDay",
        "candidateDays",
        "participantCount",
        "lockedTeams",
        "recordedResult",
        "completedAt",
    ];

    private readonly RoutingApiFactory _factory;

    /// <summary>Receives the shared, container-backed Api host factory.</summary>
    /// <param name="factory">The Api host factory booting against a throwaway PostgreSQL container.</param>
    public MatchListEndpointIntegrationTests(RoutingApiFactory factory)
    {
        _factory = factory;
    }

    /// <summary>
    /// The three token conditions, each of which must be answered with <c>401</c> and never with the
    /// concealing <c>404</c>: a request with no <c>Authorization</c> header, one with a token the
    /// pipeline rejects, and one with a token the pipeline accepts but which carries no subject claim.
    /// </summary>
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

    // Requirement 1.1 — an active member of the squad named in the path receives 200 OK carrying the
    // declared contract: the match collection and the truncation signal, with every entry member
    // present. The seeded squad holds one draft match, so the read is exercised over a real row rather
    // than over an empty list.
    [Fact]
    public async Task ListSquadMatches_ByActiveMember_Returns200AndTheDeclaredContract()
    {
        SeededListWorld world = await SeedAsync();
        using HttpClient client = CreateClient();

        using HttpResponseMessage response =
            await SendAsync(client, world.SquadId, _factory.CreateAccessToken(world.MemberUserId));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        using JsonDocument document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        JsonElement root = document.RootElement;

        // The MatchList contract itself: the entries and the truncation signal, and nothing else.
        Assert.Equal(
            new HashSet<string>(StringComparer.Ordinal) { "matches", "truncated" },
            root.EnumerateObject().Select(static member => member.Name).ToHashSet(StringComparer.Ordinal));

        Assert.False(root.GetProperty("truncated").GetBoolean());

        JsonElement entry = Assert.Single(root.GetProperty("matches").EnumerateArray().ToArray());

        // Every state-dependent member is declared even on a match that is only gathering availability:
        // the absent single values are explicit nulls and the absent collection is empty, never omitted.
        Assert.Equal(
            EntryMemberNames.ToHashSet(StringComparer.Ordinal),
            entry.EnumerateObject().Select(static member => member.Name).ToHashSet(StringComparer.Ordinal));

        Assert.Equal(world.MatchId, entry.GetProperty("matchId").GetGuid());
        Assert.Equal(Location, entry.GetProperty("location").GetString());
        Assert.Equal(JsonValueKind.Null, entry.GetProperty("confirmedDay").ValueKind);
        Assert.Equal(2, entry.GetProperty("candidateDays").GetArrayLength());
        Assert.Equal(0, entry.GetProperty("participantCount").GetInt32());
        Assert.Equal(0, entry.GetProperty("lockedTeams").GetArrayLength());
        Assert.Equal(JsonValueKind.Null, entry.GetProperty("recordedResult").ValueKind);
        Assert.Equal(JsonValueKind.Null, entry.GetProperty("completedAt").ValueKind);
    }

    // The wire shape of the enum, asserted against a real response body rather than only against the
    // emitted document: MatchState crosses as its member name, as a JSON string, never as an integer.
    [Fact]
    public async Task ListSquadMatches_ReportsMatchStateAsAMemberName()
    {
        SeededListWorld world = await SeedAsync();
        using HttpClient client = CreateClient();

        using HttpResponseMessage response =
            await SendAsync(client, world.SquadId, _factory.CreateAccessToken(world.MemberUserId));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        using JsonDocument document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        JsonElement state = document.RootElement
            .GetProperty("matches")[0]
            .GetProperty("state");

        Assert.Equal(JsonValueKind.String, state.ValueKind);
        Assert.Equal(nameof(MatchState.GatheringAvailability), state.GetString());

        // And it is genuinely this enum's vocabulary, not a coincidentally-matching string.
        Assert.Equal(MatchState.GatheringAvailability, Enum.Parse<MatchState>(state.GetString()!));
    }

    // Requirements 5.6, 5.7, 13.17 — a caller the gate refuses learns nothing. The refusal is compared
    // against the responses the already-shipped concealing reads return, so what is asserted is not
    // "some 404" but the *same* bytes the convention already emits. Both refusal causes are covered:
    // an existing squad the caller holds no membership in, and a squad that does not exist at all.
    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task ListSquadMatches_ByRefusedCaller_ReturnsTheConcealedNotFound(bool squadExists)
    {
        SeededListWorld world = await SeedAsync();
        using HttpClient client = CreateClient();

        Guid squadId = squadExists ? world.SquadId : Guid.NewGuid();
        string token = _factory.CreateAccessToken(world.StrangerUserId);

        using HttpResponseMessage refusal = await SendAsync(client, squadId, token);

        Assert.Equal(HttpStatusCode.NotFound, refusal.StatusCode);
        Assert.NotEqual(HttpStatusCode.Forbidden, refusal.StatusCode);

        byte[] refusalBody = await refusal.Content.ReadAsByteArrayAsync();

        // The shipped availability tally read, refused for the same reason. Its body is the
        // Concealed_Not_Found this read must be indistinguishable from.
        using HttpResponseMessage tallyRefusal = await SendRawAsync(
            client, $"/squads/{squadId}/matches/{Guid.NewGuid()}/availability/tally", token);

        // The shipped team-sheet read, likewise.
        using HttpResponseMessage teamSheetRefusal = await SendRawAsync(
            client, $"/matches/{Guid.NewGuid()}/team-sheet", token);

        Assert.Equal(HttpStatusCode.NotFound, tallyRefusal.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, teamSheetRefusal.StatusCode);
        Assert.Equal(await tallyRefusal.Content.ReadAsByteArrayAsync(), refusalBody);
        Assert.Equal(await teamSheetRefusal.Content.ReadAsByteArrayAsync(), refusalBody);

        // Nothing in the refusal names the cause: no `code` extension to branch on, and nothing that
        // would separate "not a member" from "no such squad".
        using JsonDocument problem = JsonDocument.Parse(refusalBody);
        Assert.False(problem.RootElement.TryGetProperty("code", out _));
        Assert.Equal(404, problem.RootElement.GetProperty("status").GetInt32());
    }

    // The three token conditions are 401 — the authentication contract — and explicitly not the
    // concealed 404. Conflating the two would tell an unauthenticated caller that the squad is hidden
    // rather than that they are unauthenticated, and would hide a broken token pipeline behind a
    // plausible-looking refusal.
    [Theory]
    [MemberData(nameof(TokenConditions))]
    public async Task ListSquadMatches_UnderEveryTokenCondition_Returns401AndNotTheConcealed404(
        TokenCondition condition)
    {
        SeededListWorld world = await SeedAsync();
        using HttpClient client = CreateClient();

        using HttpResponseMessage response = await SendAsync(client, world.SquadId, TokenFor(condition));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.NotEqual(HttpStatusCode.NotFound, response.StatusCode);

        using JsonDocument problem = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(401, problem.RootElement.GetProperty("status").GetInt32());

        // The accepted-but-subjectless token is the one condition that gets past the middleware, so it
        // is the one that must be answered by the endpoint's own Unauthenticated() result. The middleware
        // stamps a `code` extension and the endpoint's seam does not, which is how the two are told apart
        // — without that distinction this case would be indistinguishable from a rejected token and the
        // read's own branch would be untested.
        bool reachedTheEndpointLambda = !problem.RootElement.TryGetProperty("code", out _);

        Assert.Equal(
            condition == TokenCondition.AcceptedTokenWithNoSubject,
            reachedTheEndpointLambda);
    }

    /// <summary>The bearer value each token condition sends, or <see langword="null"/> to send none.</summary>
    private string? TokenFor(TokenCondition condition) => condition switch
    {
        TokenCondition.NoToken => null,
        TokenCondition.RejectedToken => InvalidBearerToken,
        TokenCondition.AcceptedTokenWithNoSubject => _factory.CreateAccessTokenWithoutSubject(),
        _ => throw new ArgumentOutOfRangeException(nameof(condition), condition, "Unhandled token condition."),
    };

    /// <summary>Sends the list read for <paramref name="squadId"/> with the given bearer value, if any.</summary>
    private static Task<HttpResponseMessage> SendAsync(HttpClient client, Guid squadId, string? token) =>
        SendRawAsync(client, $"/squads/{squadId}/matches", token);

    /// <summary>Sends a <c>GET</c> through the real pipeline, attaching <paramref name="token"/> when supplied.</summary>
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
    /// Seeds a fresh squad with one active owner membership, one draft match, and one user holding no
    /// membership anywhere, committing through the running host's own <see cref="PitchMateDbContext"/>
    /// so every row is written exactly as the application writes it.
    /// <para>
    /// A fresh squad per test is deliberate: the shared host is used by several test classes, so the
    /// read is asserted over a squad whose entire match population this test created, while every other
    /// squad in the database stands as a squad whose matches must not appear.
    /// </para>
    /// </summary>
    private async Task<SeededListWorld> SeedAsync()
    {
        using IServiceScope scope = _factory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<PitchMateDbContext>();

        DateTimeOffset now = _factory.Clock.GetUtcNow();

        Squad squad = Required(Squad.Create("Match List Squad"), "the squad");
        User member = User.Create("List Member", UniqueEmail(), emailVerified: true);
        User stranger = User.Create("List Stranger", UniqueEmail(), emailVerified: true);

        SquadMembership membership = Required(
            SquadMembership.CreateOwner(squad.Id, member.Id, "List Member"), "the owner membership");

        Match match = Required(
            Match.CreateDraft(
                Guid.CreateVersion7(),
                squad.Id,
                Location,
                [now.AddDays(7), now.AddDays(14)],
                now),
            "the draft match");

        db.AddRange(squad, member, stranger, membership, match);
        await db.SaveChangesAsync();

        return new SeededListWorld(squad.Id, member.Id, stranger.Id, match.Id);
    }

    private static string UniqueEmail() => $"match-list-{Guid.NewGuid():N}@example.com";

    private static Squad Required(PitchMate.Domain.Squads.Result<Squad> result, string what) =>
        result.IsSuccess
            ? result.Value!
            : throw new InvalidOperationException($"Seeding {what} failed: {result.Error!.Message}");

    private static SquadMembership Required(
        PitchMate.Domain.Squads.Result<SquadMembership> result, string what) =>
        result.IsSuccess
            ? result.Value!
            : throw new InvalidOperationException($"Seeding {what} failed: {result.Error!.Message}");

    private static Match Required(PitchMate.Domain.Matches.Result<Match> result, string what) =>
        result.IsSuccess
            ? result.Value!
            : throw new InvalidOperationException($"Seeding {what} failed: {result.Error!.Message}");

    /// <summary>The identities one seeded world exposes to a test.</summary>
    /// <param name="SquadId">The squad whose matches are read.</param>
    /// <param name="MemberUserId">A user holding an active owner membership of that squad.</param>
    /// <param name="StrangerUserId">A registered user holding no membership anywhere.</param>
    /// <param name="MatchId">The squad's single draft match.</param>
    private sealed record SeededListWorld(Guid SquadId, Guid MemberUserId, Guid StrangerUserId, Guid MatchId);
}
