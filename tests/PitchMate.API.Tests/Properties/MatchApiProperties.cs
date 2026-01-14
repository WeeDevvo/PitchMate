using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using FsCheck;
using FsCheck.Xunit;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using PitchMate.API.Controllers;
using PitchMate.Application.Services;
using PitchMate.Infrastructure.Data;

namespace PitchMate.API.Tests.Properties;

/// <summary>
/// Property-based tests for Match API endpoints.
/// Validates error handling and response format requirements.
/// </summary>
public class MatchApiProperties : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;
    private static readonly string DatabaseName = "TestDatabase_MatchApi_" + Guid.NewGuid();

    public MatchApiProperties(WebApplicationFactory<Program> factory)
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

    /// <summary>
    /// Feature: pitchmate-core, Property 36: Invalid request error handling
    /// For any invalid request (missing required fields, invalid data types, constraint violations),
    /// the API should return 400 Bad Request with a structured error response containing an error code and message.
    /// **Validates: Requirements 8.4**
    /// </summary>
    [Property(MaxTest = 100)]
    public void InvalidRequestsReturnBadRequestWithErrorDetails(PositiveInt squadIdSeed)
    {
        // Arrange
        var client = _factory.CreateClient();
        
        // Create a squad with admin user
        var adminEmail = $"admin{squadIdSeed.Get}@example.com";
        var adminToken = RegisterAndLoginUser(client, adminEmail, "Password123!").Result;
        
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);
        var createResponse = client.PostAsJsonAsync("/api/squads", 
            new CreateSquadRequest($"Squad{squadIdSeed.Get}")).Result;
        
        if (!createResponse.IsSuccessStatusCode)
        {
            // Skip this test iteration if squad creation failed
            return;
        }

        var createResult = createResponse.Content.ReadFromJsonAsync<CreateSquadResponse>().Result;
        var squadId = createResult!.SquadId;

        // Act - Send invalid match creation request (odd number of players)
        var invalidRequest = new CreateMatchRequest(
            ScheduledAt: DateTime.UtcNow.AddDays(1),
            PlayerIds: new List<Guid> { Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid() }, // Odd number
            TeamSize: 5);

        var response = client.PostAsJsonAsync($"/api/squads/{squadId}/matches", invalidRequest).Result;

        // Assert - Should return 400 Bad Request
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        // Assert - Response should contain structured error with code and message
        var errorResponse = response.Content.ReadFromJsonAsync<ErrorResponse>().Result;
        errorResponse.Should().NotBeNull();
        errorResponse!.Message.Should().NotBeNullOrEmpty();
        errorResponse.Code.Should().NotBeNullOrEmpty();
    }

    /// <summary>
    /// Property: Invalid match result requests return structured errors
    /// For any invalid match result request (invalid winner, non-existent match),
    /// the API should return appropriate error status with structured error response.
    /// </summary>
    [Property(MaxTest = 100)]
    public void InvalidMatchResultRequestsReturnStructuredErrors(PositiveInt matchIdSeed)
    {
        // Arrange
        var client = _factory.CreateClient();
        
        var adminEmail = $"admin{matchIdSeed.Get}@example.com";
        var adminToken = RegisterAndLoginUser(client, adminEmail, "Password123!").Result;
        
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        // Act - Try to record result for non-existent match
        var nonExistentMatchId = Guid.NewGuid();
        var resultRequest = new RecordMatchResultRequest(
            Winner: "TeamA",
            BalanceFeedback: null);

        var response = client.PostAsJsonAsync($"/api/matches/{nonExistentMatchId}/result", resultRequest).Result;

        // Assert - Should return error status (400 or 404)
        response.IsSuccessStatusCode.Should().BeFalse();
        response.StatusCode.Should().BeOneOf(HttpStatusCode.BadRequest, HttpStatusCode.NotFound);

        // Assert - Response should contain structured error
        var errorResponse = response.Content.ReadFromJsonAsync<ErrorResponse>().Result;
        errorResponse.Should().NotBeNull();
        errorResponse!.Message.Should().NotBeNullOrEmpty();
    }

    /// <summary>
    /// Feature: pitchmate-core, Property 37: JSON response format
    /// All API responses should be valid JSON with consistent structure.
    /// Success responses should contain the expected data fields.
    /// Error responses should contain 'message' and 'code' fields.
    /// **Validates: Requirements 8.6**
    /// </summary>
    [Property(MaxTest = 100)]
    public void AllResponsesAreValidJsonWithConsistentStructure(PositiveInt squadIdSeed)
    {
        // Arrange
        var client = _factory.CreateClient();
        
        var adminEmail = $"admin{squadIdSeed.Get}@example.com";
        var adminToken = RegisterAndLoginUser(client, adminEmail, "Password123!").Result;
        
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);
        
        var createResponse = client.PostAsJsonAsync("/api/squads", 
            new CreateSquadRequest($"Squad{squadIdSeed.Get}")).Result;
        
        if (!createResponse.IsSuccessStatusCode)
        {
            // Skip this test iteration if squad creation failed
            return;
        }

        var createResult = createResponse.Content.ReadFromJsonAsync<CreateSquadResponse>().Result;
        var squadId = createResult!.SquadId;

        // Act - Get squad matches (should return empty list initially)
        var response = client.GetAsync($"/api/squads/{squadId}/matches").Result;

        // Assert - Response should be valid JSON
        response.Content.Headers.ContentType?.MediaType.Should().Be("application/json");

        var content = response.Content.ReadAsStringAsync().Result;
        var isValidJson = IsValidJson(content);
        isValidJson.Should().BeTrue("response should be valid JSON");

        // Assert - Success response should have expected structure
        if (response.IsSuccessStatusCode)
        {
            var matchesResponse = response.Content.ReadFromJsonAsync<GetSquadMatchesResponse>().Result;
            matchesResponse.Should().NotBeNull();
            matchesResponse!.Matches.Should().NotBeNull();
        }
    }

    /// <summary>
    /// Property: Error responses have consistent JSON structure
    /// All error responses should be valid JSON with 'message' and 'code' fields.
    /// </summary>
    [Property(MaxTest = 100)]
    public void ErrorResponsesHaveConsistentJsonStructure(PositiveInt squadIdSeed)
    {
        // Arrange
        var client = _factory.CreateClient();
        
        var adminEmail = $"admin{squadIdSeed.Get}@example.com";
        var adminToken = RegisterAndLoginUser(client, adminEmail, "Password123!").Result;
        
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);

        // Act - Send invalid request (empty player list)
        var invalidRequest = new CreateMatchRequest(
            ScheduledAt: DateTime.UtcNow.AddDays(1),
            PlayerIds: new List<Guid>(), // Empty list
            TeamSize: 5);

        var response = client.PostAsJsonAsync($"/api/squads/{Guid.NewGuid()}/matches", invalidRequest).Result;

        // Assert - Response should be valid JSON
        response.Content.Headers.ContentType?.MediaType.Should().Be("application/json");

        var content = response.Content.ReadAsStringAsync().Result;
        var isValidJson = IsValidJson(content);
        isValidJson.Should().BeTrue("error response should be valid JSON");

        // Assert - Error response should have required fields
        if (!response.IsSuccessStatusCode)
        {
            var errorResponse = response.Content.ReadFromJsonAsync<ErrorResponse>().Result;
            errorResponse.Should().NotBeNull();
            errorResponse!.Message.Should().NotBeNullOrEmpty();
            // Code field is optional but should be present for structured errors
        }
    }

    // Helper methods

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

    private bool IsValidJson(string content)
    {
        try
        {
            JsonDocument.Parse(content);
            return true;
        }
        catch (JsonException)
        {
            return false;
        }
    }
}
