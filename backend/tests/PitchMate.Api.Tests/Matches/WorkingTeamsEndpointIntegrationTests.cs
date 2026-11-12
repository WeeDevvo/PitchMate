using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using PitchMate.Api.Tests.Auth;
using PitchMate.Domain.Auth;
using PitchMate.Domain.Matches;
using PitchMate.Domain.Rating;
using PitchMate.Domain.Squads;
using PitchMate.Infrastructure.Persistence;

namespace PitchMate.Api.Tests.Matches;

/// <summary>
/// Api-level tests for <c>GET /matches/{matchId}/teams</c> (match-read-models task 11.8), through the
/// application's <b>real request pipeline</b> against a throwaway PostgreSQL container.
/// <list type="bullet">
/// <item>An organiser receives <c>200 OK</c> and the declared contract, team ids and prediction included.</item>
/// <item>An active plain member, a non-member, and a caller naming a match that does not exist all
/// receive the <b>identical</b> concealed <c>404</c> — status and body — so a refusal discloses neither
/// the match's existence nor the caller's role. (An active <i>guest</i> cannot hold a token, so the
/// Organiser_Gate's refusal of a guest is asserted at the handler, in <c>GetWorkingTeamsHandlerTests</c>.)</item>
/// <item>Every token condition is <c>401</c>.</item>
/// <item>A prediction failure surfaces as the seam's existing <c>ValidationFailed</c> response with no
/// partial arrangement.</item>
/// </list>
/// <para>Validates: Requirements 4.19, 5.2, 5.8, 5.12, 13.17.</para>
/// </summary>
public sealed class WorkingTeamsEndpointIntegrationTests : IClassFixture<RoutingApiFactory>
{
    private readonly RoutingApiFactory _factory;

    /// <summary>Receives the shared, container-backed Api host factory.</summary>
    public WorkingTeamsEndpointIntegrationTests(RoutingApiFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task GetWorkingTeams_ByOrganiser_Returns200AndTheDeclaredContract()
    {
        SeededTeamsWorld world = await SeedAsync();
        using HttpClient client = CreateClient(_factory);

        using HttpResponseMessage response = await SendAsync(client, world.MatchId, _factory.CreateAccessToken(world.OwnerUserId));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using JsonDocument document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        JsonElement view = document.RootElement;

        Assert.Equal(
            new HashSet<string>(StringComparer.Ordinal) { "teams", "prediction", "unassignedParticipants" },
            view.EnumerateObject().Select(static member => member.Name).ToHashSet(StringComparer.Ordinal));

        JsonElement[] teams = [.. view.GetProperty("teams").EnumerateArray()];
        Assert.Equal(2, teams.Length);
        Assert.All(teams, static team => Assert.Equal(
            new HashSet<string>(StringComparer.Ordinal) { "teamId", "teamName", "bibFlag", "roster" },
            team.EnumerateObject().Select(static member => member.Name).ToHashSet(StringComparer.Ordinal)));
        Assert.Equal(world.TeamIds.Order(), teams.Select(static team => team.GetProperty("teamId").GetGuid()).Order());

        JsonElement prediction = view.GetProperty("prediction");
        Assert.Equal(2, prediction.GetProperty("winProbabilities").GetArrayLength());
        Assert.Equal(JsonValueKind.Number, prediction.GetProperty("drawProbability").ValueKind);
        Assert.Equal(0, view.GetProperty("unassignedParticipants").GetArrayLength());
    }

    [Fact]
    public async Task GetWorkingTeams_RefusedCallers_AllReceiveTheIdenticalConcealedNotFound()
    {
        SeededTeamsWorld world = await SeedAsync();
        using HttpClient client = CreateClient(_factory);

        using HttpResponseMessage member = await SendAsync(client, world.MatchId, _factory.CreateAccessToken(world.MemberUserId));
        using HttpResponseMessage stranger = await SendAsync(client, world.MatchId, _factory.CreateAccessToken(world.StrangerUserId));
        using HttpResponseMessage missing = await SendAsync(client, Guid.NewGuid(), _factory.CreateAccessToken(world.OwnerUserId));

        byte[] memberBody = await member.Content.ReadAsByteArrayAsync();

        Assert.All([member, stranger, missing], static response => Assert.Equal(HttpStatusCode.NotFound, response.StatusCode));
        Assert.Equal(memberBody, await stranger.Content.ReadAsByteArrayAsync());
        Assert.Equal(memberBody, await missing.Content.ReadAsByteArrayAsync());

        using JsonDocument problem = JsonDocument.Parse(memberBody);
        Assert.False(problem.RootElement.TryGetProperty("code", out _));
    }

    [Theory]
    [InlineData("none")]
    [InlineData("rejected")]
    [InlineData("subjectless")]
    public async Task GetWorkingTeams_UnderEveryTokenCondition_Returns401(string condition)
    {
        SeededTeamsWorld world = await SeedAsync();
        using HttpClient client = CreateClient(_factory);

        string? token = condition switch
        {
            "none" => null,
            "rejected" => "not-a-real.jwt.token",
            _ => _factory.CreateAccessTokenWithoutSubject(),
        };

        using HttpResponseMessage response = await SendAsync(client, world.MatchId, token);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task GetWorkingTeams_WhenPredictionFails_ReturnsValidationFailedAndNoArrangement()
    {
        SeededTeamsWorld world = await SeedAsync();
        using WebApplicationFactory<PitchMate.Api.Auth.Endpoints.LinkExternalProviderRequest> failing = _factory.WithWebHostBuilder(builder =>
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<IRatingEngine>();
                services.AddSingleton<IRatingEngine>(new PredictionFailingEngine());
            }));
        using HttpClient client = CreateClient(failing);

        using HttpResponseMessage response = await SendAsync(client, world.MatchId, _factory.CreateAccessToken(world.OwnerUserId));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        using JsonDocument problem = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(nameof(MatchErrorCode.ValidationFailed), problem.RootElement.GetProperty("code").GetString());
        Assert.False(problem.RootElement.TryGetProperty("teams", out _));
    }

    private static async Task<HttpResponseMessage> SendAsync(HttpClient client, Guid matchId, string? token)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"/matches/{matchId}/teams");
        if (token is not null)
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        }

        return await client.SendAsync(request);
    }

    private static HttpClient CreateClient<T>(WebApplicationFactory<T> factory)
        where T : class =>
        factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

    /// <summary>
    /// Seeds a squad with an owner and a plain member, a user holding no membership, and a confirmed match
    /// both members play in, split into two unlocked one-player teams.
    /// </summary>
    private async Task<SeededTeamsWorld> SeedAsync()
    {
        using IServiceScope scope = _factory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<PitchMateDbContext>();
        DateTimeOffset now = _factory.Clock.GetUtcNow();

        Squad squad = Squad.Create("Working Teams Squad").Value!;
        User owner = User.Create("Teams Owner", UniqueEmail(), emailVerified: true);
        User member = User.Create("Teams Member", UniqueEmail(), emailVerified: true);
        User stranger = User.Create("Teams Stranger", UniqueEmail(), emailVerified: true);
        SquadMembership ownership = SquadMembership.CreateOwner(squad.Id, owner.Id, "Teams Owner").Value!;
        SquadMembership membership = SquadMembership.CreateRegistered(squad.Id, member.Id, "Teams Member").Value!;

        Match match = Match.CreateDraft(Guid.CreateVersion7(), squad.Id, "Mabley Green", [now.AddDays(7)], now).Value!;
        Assert.True(match.Confirm(now.AddDays(7), []).IsSuccess);
        Assert.True(match.AddParticipant(ownership).IsSuccess);
        Assert.True(match.AddParticipant(membership).IsSuccess);
        Assert.True(match.ApplyTeamProposal(
        [
            new ProposedTeam("Reds", BibFlag: false, [ownership.Id]),
            new ProposedTeam("Bibs", BibFlag: true, [membership.Id]),
        ]).IsSuccess);

        db.AddRange(squad, owner, member, stranger, ownership, membership, match);
        await db.SaveChangesAsync();

        return new SeededTeamsWorld(match.Id, owner.Id, member.Id, stranger.Id, [.. match.Teams.Select(static team => team.Id)]);
    }

    private static string UniqueEmail() => $"working-teams-{Guid.NewGuid():N}@example.com";

    private sealed record SeededTeamsWorld(Guid MatchId, Guid OwnerUserId, Guid MemberUserId, Guid StrangerUserId, IReadOnlyList<Guid> TeamIds);

    /// <summary>An engine that seeds normally and fails every prediction.</summary>
    private sealed class PredictionFailingEngine : IRatingEngine
    {
        public PitchMate.Domain.Rating.Result<Rating> CreateRating(SkillTier? tier = null) => PitchMate.Domain.Rating.Result<Rating>.Ok(new Rating(25, 8));

        public PitchMate.Domain.Rating.Result<MatchPrediction> Predict(IReadOnlyList<TeamRoster> rosters) =>
            PitchMate.Domain.Rating.Result<MatchPrediction>.Fail(new RatingError(RatingErrorCode.NonFiniteValue, "planted prediction failure"));

        public PitchMate.Domain.Rating.Result<RatingState> GetState(Rating rating) => throw new NotSupportedException();

        public PitchMate.Domain.Rating.Result<MatchUpdate> UpdateRatings(MatchOutcome outcome) => throw new NotSupportedException();

        public PitchMate.Domain.Rating.Result<IReadOnlyList<Rating>> Replay(IReadOnlyList<Rating> initialRatings, IReadOnlyList<ReplayMatch> matches) =>
            throw new NotSupportedException();

        public PitchMate.Domain.Rating.Result<Rating> DecayInactivity(Rating rating, int inactiveDays) => throw new NotSupportedException();
    }
}
