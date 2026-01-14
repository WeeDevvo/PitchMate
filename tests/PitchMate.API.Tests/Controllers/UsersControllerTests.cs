using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PitchMate.API.Controllers;
using PitchMate.Application.Services;
using PitchMate.Infrastructure.Data;

namespace PitchMate.API.Tests.Controllers;

/// <summary>
/// Integration tests for UsersController.
/// Tests user profile and rating endpoints.
/// </summary>
public class UsersControllerTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public UsersControllerTests(WebApplicationFactory<Program> factory)
    {
        _factory = factory.WithWebHostBuilder(builder =>
        {
            builder.ConfigureServices(services =>
            {
                // Remove the existing DbContext registration
                var descriptor = services.SingleOrDefault(
                    d => d.ServiceType == typeof(DbContextOptions<PitchMateDbContext>));
                if (descriptor != null)
                {
                    services.Remove(descriptor);
                }

                // Add in-memory database for testing
                services.AddDbContext<PitchMateDbContext>(options =>
                {
                    options.UseInMemoryDatabase("TestDatabase_" + Guid.NewGuid());
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
    public async Task GetCurrentUser_WithAuthentication_ReturnsUserInfo()
    {
        // Arrange
        var client = _factory.CreateClient();
        var email = "currentuser@example.com";
        var token = await RegisterAndLoginUser(client, email, "Password123!");
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        // Get userId from login
        var loginResponse = await client.PostAsJsonAsync("/api/auth/login", new LoginRequest(email, "Password123!"));
        var loginResult = await loginResponse.Content.ReadFromJsonAsync<LoginResponse>();

        // Act
        var response = await client.GetAsync("/api/users/me");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var result = await response.Content.ReadFromJsonAsync<GetCurrentUserResponse>();
        result.Should().NotBeNull();
        result!.UserId.Should().Be(loginResult!.UserId);
        result.Email.Should().Be(email);
    }

    [Fact]
    public async Task GetCurrentUser_WithoutAuthentication_ReturnsUnauthorized()
    {
        // Arrange
        var client = _factory.CreateClient();

        // Act
        var response = await client.GetAsync("/api/users/me");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task GetCurrentUserSquads_WithSquads_ReturnsSquadsWithRatings()
    {
        // Arrange
        var client = _factory.CreateClient();
        var token = await RegisterAndLoginUser(client, "withsquads@example.com", "Password123!");
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        // Create a squad
        var createSquadResponse = await client.PostAsJsonAsync("/api/squads", 
            new CreateSquadRequest("Test Squad"));
        var createSquadResult = await createSquadResponse.Content.ReadFromJsonAsync<CreateSquadResponse>();

        // Act
        var response = await client.GetAsync("/api/users/me/squads");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var result = await response.Content.ReadFromJsonAsync<GetUserSquadsWithRatingsResponse>();
        result.Should().NotBeNull();
        result!.Squads.Should().HaveCount(1);
        result.Squads[0].SquadId.Should().Be(createSquadResult!.SquadId);
        result.Squads[0].Name.Should().Be("Test Squad");
        result.Squads[0].CurrentRating.Should().Be(1000); // Default rating
        result.Squads[0].IsAdmin.Should().BeTrue(); // Creator is admin
    }

    [Fact]
    public async Task GetCurrentUserSquads_WithoutAuthentication_ReturnsUnauthorized()
    {
        // Arrange
        var client = _factory.CreateClient();

        // Act
        var response = await client.GetAsync("/api/users/me/squads");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task GetUserRatingInSquad_WithValidMembership_ReturnsRating()
    {
        // Arrange
        var client = _factory.CreateClient();
        var email = "ratingtest@example.com";
        var token = await RegisterAndLoginUser(client, email, "Password123!");
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        // Get userId
        var loginResponse = await client.PostAsJsonAsync("/api/auth/login", new LoginRequest(email, "Password123!"));
        var loginResult = await loginResponse.Content.ReadFromJsonAsync<LoginResponse>();

        // Create a squad
        var createSquadResponse = await client.PostAsJsonAsync("/api/squads", 
            new CreateSquadRequest("Rating Test Squad"));
        var createSquadResult = await createSquadResponse.Content.ReadFromJsonAsync<CreateSquadResponse>();

        // Act
        var response = await client.GetAsync(
            $"/api/users/{loginResult!.UserId}/squads/{createSquadResult!.SquadId}/rating");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var result = await response.Content.ReadFromJsonAsync<GetUserRatingResponse>();
        result.Should().NotBeNull();
        result!.UserId.Should().Be(loginResult.UserId);
        result.SquadId.Should().Be(createSquadResult.SquadId);
        result.CurrentRating.Should().Be(1000); // Default rating
    }

    [Fact]
    public async Task GetUserRatingInSquad_WithoutAuthentication_ReturnsUnauthorized()
    {
        // Arrange
        var client = _factory.CreateClient();
        var userId = Guid.NewGuid();
        var squadId = Guid.NewGuid();

        // Act
        var response = await client.GetAsync($"/api/users/{userId}/squads/{squadId}/rating");

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
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
}
