using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using PitchMate.API.Controllers;
using PitchMate.Application.Services;
using PitchMate.Infrastructure.Data;

namespace PitchMate.API.Tests.Controllers;

/// <summary>
/// Integration tests for MatchesController.
/// Tests match creation, result recording, and match queries.
/// </summary>
public class MatchesControllerTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;
    private static readonly string DatabaseName = "TestDatabase_Matches_" + Guid.NewGuid();

    public MatchesControllerTests(WebApplicationFactory<Program> factory)
    {
        _factory = factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration((context, config) =>
            {
                // Add in-memory configuration for JWT
                config.AddInMemoryCollection(new Dictionary<string, string>
                {
                    ["Jwt:SecretKey"] = "ThisIsASecretKeyForTestingPurposesOnly12345678",
                    ["Jwt:Issuer"] = "PitchMate",
                    ["Jwt:Audience"] = "PitchMate",
                    ["Jwt:ExpirationMinutes"] = "60"
                }!);
            });

            builder.ConfigureServices(services =>
            {
                // Remove the existing DbContext registration
                var descriptor = services.SingleOrDefault(
                    d => d.ServiceType == typeof(DbContextOptions<PitchMateDbContext>));
                if (descriptor != null)
                {
                    services.Remove(descriptor);
                }

                // Add in-memory database for testing with consistent name
                services.AddDbContext<PitchMateDbContext>(options =>
                {
                    options.UseInMemoryDatabase(DatabaseName);
                });

                // Replace Google token validator with mock
                var googleValidatorDescriptor = services.SingleOrDefault(
                    d => d.ServiceType == typeof(IGoogleTokenValidator));
                if (googleValidatorDescriptor != null)
                {
                    services.Remove(googleValidatorDescriptor);
                }
                services.AddScoped<IGoogleTokenValidator, MockGoogleTokenValidator>();
            });
        });
    }

    [Fact]
    public async Task CreateMatch_AsAdmin_WithValidRequest_ReturnsCreated()
    {
        // Arrange
        var client = _factory.CreateClient();
        var (squadId, adminToken, playerIds) = await SetupSquadWithPlayers(client, 4);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        var request = new CreateMatchRequest(
            ScheduledAt: DateTime.UtcNow.AddDays(1),
            PlayerIds: playerIds,
            TeamSize: 5);

        // Act
        var response = await client.PostAsJsonAsync($"/api/squads/{squadId}/matches", request);

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var result = await response.Content.ReadFromJsonAsync<CreateMatchResponse>();
        result.Should().NotBeNull();
        result!.MatchId.Should().NotBeEmpty();
    }

    [Fact]
    public async Task CreateMatch_AsNonAdmin_ReturnsForbidden()
    {
        // Arrange
        var client = _factory.CreateClient();
        var (squadId, _, playerIds) = await SetupSquadWithPlayers(client, 4);
        
        // Join as non-admin
        var nonAdminToken = await RegisterAndLoginUser(client, "nonadmin@example.com", "Password123!");
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", nonAdminToken);
        await client.PostAsync($"/api/squads/{squadId}/join", null);

        var request = new CreateMatchRequest(
            ScheduledAt: DateTime.UtcNow.AddDays(1),
            PlayerIds: playerIds,
            TeamSize: 5);

        // Act
        var response = await client.PostAsJsonAsync($"/api/squads/{squadId}/matches", request);

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        var error = await response.Content.ReadFromJsonAsync<ErrorResponse>();
        error.Should().NotBeNull();
        error!.Code.Should().Be("AUTHZ_001");
    }

    [Fact]
    public async Task CreateMatch_WithOddPlayerCount_ReturnsBadRequest()
    {
        // Arrange
        var client = _factory.CreateClient();
        var (squadId, adminToken, playerIds) = await SetupSquadWithPlayers(client, 3);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        var request = new CreateMatchRequest(
            ScheduledAt: DateTime.UtcNow.AddDays(1),
            PlayerIds: playerIds,
            TeamSize: 5);

        // Act
        var response = await client.PostAsJsonAsync($"/api/squads/{squadId}/matches", request);

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var error = await response.Content.ReadFromJsonAsync<ErrorResponse>();
        error.Should().NotBeNull();
        error!.Code.Should().Be("VAL_003");
    }

    [Fact]
    public async Task CreateMatch_WithLessThanTwoPlayers_ReturnsBadRequest()
    {
        // Arrange
        var client = _factory.CreateClient();
        var (squadId, adminToken, _) = await SetupSquadWithPlayers(client, 2);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        // Get only one player
        var response = await client.GetAsync("/api/squads");
        var squadsResult = await response.Content.ReadFromJsonAsync<GetUserSquadsResponse>();
        var singlePlayerId = new List<Guid> { squadsResult!.Squads[0].SquadId }; // Just use squad ID as placeholder

        var request = new CreateMatchRequest(
            ScheduledAt: DateTime.UtcNow.AddDays(1),
            PlayerIds: new List<Guid>(), // Empty list
            TeamSize: 5);

        // Act
        var matchResponse = await client.PostAsJsonAsync($"/api/squads/{squadId}/matches", request);

        // Assert
        matchResponse.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task CreateMatch_WithoutAuthentication_ReturnsUnauthorized()
    {
        // Arrange
        var client = _factory.CreateClient();
        var squadId = Guid.NewGuid();
        var request = new CreateMatchRequest(
            ScheduledAt: DateTime.UtcNow.AddDays(1),
            PlayerIds: new List<Guid> { Guid.NewGuid(), Guid.NewGuid() },
            TeamSize: 5);

        // Act
        var response = await client.PostAsJsonAsync($"/api/squads/{squadId}/matches", request);

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task GetSquadMatches_WithAuthentication_ReturnsMatches()
    {
        // Arrange
        var client = _factory.CreateClient();
        var (squadId, adminToken, playerIds) = await SetupSquadWithPlayers(client, 4);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        // Create a match
        var createRequest = new CreateMatchRequest(
            ScheduledAt: DateTime.UtcNow.AddDays(1),
            PlayerIds: playerIds,
            TeamSize: 5);
        await client.PostAsJsonAsync($"/api/squads/{squadId}/matches", createRequest);

        // Act
        var response = await client.GetAsync($"/api/squads/{squadId}/matches");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var result = await response.Content.ReadFromJsonAsync<GetSquadMatchesResponse>();
        result.Should().NotBeNull();
        result!.Matches.Should().NotBeEmpty();
        result.Matches.Should().HaveCount(1);
        result.Matches[0].Status.Should().Be("Pending");
        result.Matches[0].PlayerCount.Should().Be(4);
    }

    [Fact]
    public async Task GetSquadMatches_WithoutAuthentication_ReturnsUnauthorized()
    {
        // Arrange
        var client = _factory.CreateClient();
        var squadId = Guid.NewGuid();

        // Act
        var response = await client.GetAsync($"/api/squads/{squadId}/matches");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task GetMatchDetails_WithValidMatchId_ReturnsMatchDetails()
    {
        // Arrange
        var client = _factory.CreateClient();
        var (squadId, adminToken, playerIds) = await SetupSquadWithPlayers(client, 4);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        // Create a match
        var createRequest = new CreateMatchRequest(
            ScheduledAt: DateTime.UtcNow.AddDays(1),
            PlayerIds: playerIds,
            TeamSize: 5);
        var createResponse = await client.PostAsJsonAsync($"/api/squads/{squadId}/matches", createRequest);
        var createResult = await createResponse.Content.ReadFromJsonAsync<CreateMatchResponse>();
        var matchId = createResult!.MatchId;

        // Act
        var response = await client.GetAsync($"/api/matches/{matchId}");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var result = await response.Content.ReadFromJsonAsync<MatchDetailsResponse>();
        result.Should().NotBeNull();
        result!.MatchId.Should().Be(matchId);
        result.SquadId.Should().Be(squadId);
        result.Status.Should().Be("Pending");
        result.TeamA.Should().NotBeNull();
        result.TeamB.Should().NotBeNull();
        result.TeamA!.Players.Should().HaveCount(2);
        result.TeamB!.Players.Should().HaveCount(2);
    }

    [Fact]
    public async Task GetMatchDetails_WithInvalidMatchId_ReturnsNotFound()
    {
        // Arrange
        var client = _factory.CreateClient();
        var token = await RegisterAndLoginUser(client, "user@example.com", "Password123!");
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var matchId = Guid.NewGuid();

        // Act
        var response = await client.GetAsync($"/api/matches/{matchId}");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task RecordMatchResult_AsAdmin_WithValidRequest_ReturnsSuccess()
    {
        // Arrange
        var client = _factory.CreateClient();
        var (squadId, adminToken, playerIds) = await SetupSquadWithPlayers(client, 4);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        // Create a match
        var createRequest = new CreateMatchRequest(
            ScheduledAt: DateTime.UtcNow.AddDays(1),
            PlayerIds: playerIds,
            TeamSize: 5);
        var createResponse = await client.PostAsJsonAsync($"/api/squads/{squadId}/matches", createRequest);
        var createResult = await createResponse.Content.ReadFromJsonAsync<CreateMatchResponse>();
        var matchId = createResult!.MatchId;

        // Act
        var resultRequest = new RecordMatchResultRequest(
            Winner: "TeamA",
            BalanceFeedback: "Well balanced");
        var response = await client.PostAsJsonAsync($"/api/matches/{matchId}/result", resultRequest);

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var result = await response.Content.ReadFromJsonAsync<RecordMatchResultResponse>();
        result.Should().NotBeNull();
        result!.Success.Should().BeTrue();
    }

    [Fact]
    public async Task RecordMatchResult_AsNonAdmin_ReturnsForbidden()
    {
        // Arrange
        var client = _factory.CreateClient();
        var (squadId, adminToken, playerIds) = await SetupSquadWithPlayers(client, 4);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        // Create a match
        var createRequest = new CreateMatchRequest(
            ScheduledAt: DateTime.UtcNow.AddDays(1),
            PlayerIds: playerIds,
            TeamSize: 5);
        var createResponse = await client.PostAsJsonAsync($"/api/squads/{squadId}/matches", createRequest);
        var createResult = await createResponse.Content.ReadFromJsonAsync<CreateMatchResponse>();
        var matchId = createResult!.MatchId;

        // Join as non-admin
        var nonAdminToken = await RegisterAndLoginUser(client, "nonadmin2@example.com", "Password123!");
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", nonAdminToken);
        await client.PostAsync($"/api/squads/{squadId}/join", null);

        // Act
        var resultRequest = new RecordMatchResultRequest(
            Winner: "TeamA",
            BalanceFeedback: null);
        var response = await client.PostAsJsonAsync($"/api/matches/{matchId}/result", resultRequest);

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        var error = await response.Content.ReadFromJsonAsync<ErrorResponse>();
        error.Should().NotBeNull();
        error!.Code.Should().Be("AUTHZ_001");
    }

    [Fact]
    public async Task RecordMatchResult_ForCompletedMatch_ReturnsBadRequest()
    {
        // Arrange
        var client = _factory.CreateClient();
        var (squadId, adminToken, playerIds) = await SetupSquadWithPlayers(client, 4);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        // Create a match
        var createRequest = new CreateMatchRequest(
            ScheduledAt: DateTime.UtcNow.AddDays(1),
            PlayerIds: playerIds,
            TeamSize: 5);
        var createResponse = await client.PostAsJsonAsync($"/api/squads/{squadId}/matches", createRequest);
        var createResult = await createResponse.Content.ReadFromJsonAsync<CreateMatchResponse>();
        var matchId = createResult!.MatchId;

        // Record result once
        var resultRequest = new RecordMatchResultRequest(
            Winner: "TeamA",
            BalanceFeedback: null);
        await client.PostAsJsonAsync($"/api/matches/{matchId}/result", resultRequest);

        // Act - Try to record result again
        var response = await client.PostAsJsonAsync($"/api/matches/{matchId}/result", resultRequest);

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var error = await response.Content.ReadFromJsonAsync<ErrorResponse>();
        error.Should().NotBeNull();
        error!.Code.Should().Be("BUS_002");
    }

    [Fact]
    public async Task RecordMatchResult_WithInvalidWinner_ReturnsBadRequest()
    {
        // Arrange
        var client = _factory.CreateClient();
        var (squadId, adminToken, playerIds) = await SetupSquadWithPlayers(client, 4);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        // Create a match
        var createRequest = new CreateMatchRequest(
            ScheduledAt: DateTime.UtcNow.AddDays(1),
            PlayerIds: playerIds,
            TeamSize: 5);
        var createResponse = await client.PostAsJsonAsync($"/api/squads/{squadId}/matches", createRequest);
        var createResult = await createResponse.Content.ReadFromJsonAsync<CreateMatchResponse>();
        var matchId = createResult!.MatchId;

        // Act
        var resultRequest = new RecordMatchResultRequest(
            Winner: "InvalidTeam",
            BalanceFeedback: null);
        var response = await client.PostAsJsonAsync($"/api/matches/{matchId}/result", resultRequest);

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task RecordMatchResult_WithDraw_ReturnsSuccess()
    {
        // Arrange
        var client = _factory.CreateClient();
        var (squadId, adminToken, playerIds) = await SetupSquadWithPlayers(client, 4);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        // Create a match
        var createRequest = new CreateMatchRequest(
            ScheduledAt: DateTime.UtcNow.AddDays(1),
            PlayerIds: playerIds,
            TeamSize: 5);
        var createResponse = await client.PostAsJsonAsync($"/api/squads/{squadId}/matches", createRequest);
        var createResult = await createResponse.Content.ReadFromJsonAsync<CreateMatchResponse>();
        var matchId = createResult!.MatchId;

        // Act
        var resultRequest = new RecordMatchResultRequest(
            Winner: "Draw",
            BalanceFeedback: "Very close game");
        var response = await client.PostAsJsonAsync($"/api/matches/{matchId}/result", resultRequest);

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var result = await response.Content.ReadFromJsonAsync<RecordMatchResultResponse>();
        result.Should().NotBeNull();
        result!.Success.Should().BeTrue();
    }

    [Fact]
    public async Task RecordMatchResult_WithoutAuthentication_ReturnsUnauthorized()
    {
        // Arrange
        var client = _factory.CreateClient();
        var matchId = Guid.NewGuid();
        var resultRequest = new RecordMatchResultRequest(
            Winner: "TeamA",
            BalanceFeedback: null);

        // Act
        var response = await client.PostAsJsonAsync($"/api/matches/{matchId}/result", resultRequest);

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    // Helper methods

    private async Task<(Guid squadId, string adminToken, List<Guid> playerIds)> SetupSquadWithPlayers(
        HttpClient client, int playerCount)
    {
        // Create squad with admin
        var adminToken = await RegisterAndLoginUser(client, $"admin_{Guid.NewGuid()}@example.com", "Password123!");
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);
        
        var createResponse = await client.PostAsJsonAsync("/api/squads", new CreateSquadRequest("Test Squad"));
        createResponse.EnsureSuccessStatusCode();
        var createResult = await createResponse.Content.ReadFromJsonAsync<CreateSquadResponse>();
        var squadId = createResult!.SquadId;

        // Get admin user ID from token
        var adminUserId = GetCurrentUserId(adminToken);
        
        var playerIds = new List<Guid> { adminUserId };

        // Add additional players
        for (int i = 1; i < playerCount; i++)
        {
            var playerEmail = $"player_{Guid.NewGuid()}@example.com";
            var playerToken = await RegisterAndLoginUser(client, playerEmail, "Password123!");
            var playerId = GetCurrentUserId(playerToken);
            
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", playerToken);
            await client.PostAsync($"/api/squads/{squadId}/join", null);
            
            playerIds.Add(playerId);
        }

        // Reset to admin token
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        return (squadId, adminToken, playerIds);
    }

    private async Task<string> RegisterAndLoginUser(HttpClient client, string email, string password)
    {
        await RegisterUser(client, email, password);
        return await LoginUser(client, email, password);
    }

    private async Task RegisterUser(HttpClient client, string email, string password)
    {
        await client.PostAsJsonAsync("/api/auth/register", new RegisterRequest(email, password));
    }

    private async Task<string> LoginUser(HttpClient client, string email, string password)
    {
        var response = await client.PostAsJsonAsync("/api/auth/login", new LoginRequest(email, password));
        var result = await response.Content.ReadFromJsonAsync<LoginResponse>();
        return result!.Token;
    }

    private Guid GetCurrentUserId(string token)
    {
        // Decode JWT token to extract user ID
        // JWT format: header.payload.signature
        var parts = token.Split('.');
        if (parts.Length != 3)
            throw new InvalidOperationException("Invalid JWT token format");

        // Decode the payload (base64url encoded)
        var payload = parts[1];
        // Add padding if needed
        switch (payload.Length % 4)
        {
            case 2: payload += "=="; break;
            case 3: payload += "="; break;
        }
        
        var payloadBytes = Convert.FromBase64String(payload.Replace('-', '+').Replace('_', '/'));
        var payloadJson = System.Text.Encoding.UTF8.GetString(payloadBytes);
        
        // Parse JSON to extract user ID (sub claim)
        var doc = System.Text.Json.JsonDocument.Parse(payloadJson);
        var subClaim = doc.RootElement.GetProperty("sub").GetString();
        
        return Guid.Parse(subClaim!);
    }
}
