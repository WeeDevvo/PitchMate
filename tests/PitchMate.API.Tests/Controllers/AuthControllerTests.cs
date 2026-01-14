using System.Net;
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
/// Integration tests for AuthController.
/// Tests registration, login, and Google OAuth flows.
/// </summary>
public class AuthControllerTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public AuthControllerTests(WebApplicationFactory<Program> factory)
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
    public async Task Register_WithValidCredentials_ReturnsCreated()
    {
        // Arrange
        var client = _factory.CreateClient();
        var request = new RegisterRequest("test@example.com", "Password123!");

        // Act
        var response = await client.PostAsJsonAsync("/api/auth/register", request);

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var result = await response.Content.ReadFromJsonAsync<RegisterResponse>();
        result.Should().NotBeNull();
        result!.UserId.Should().NotBeEmpty();
    }

    [Fact]
    public async Task Register_WithInvalidEmail_ReturnsBadRequest()
    {
        // Arrange
        var client = _factory.CreateClient();
        var request = new RegisterRequest("invalid-email", "Password123!");

        // Act
        var response = await client.PostAsJsonAsync("/api/auth/register", request);

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var error = await response.Content.ReadFromJsonAsync<ErrorResponse>();
        error.Should().NotBeNull();
        error!.Code.Should().Be("VAL_001");
    }

    [Fact]
    public async Task Register_WithDuplicateEmail_ReturnsBadRequest()
    {
        // Arrange
        var client = _factory.CreateClient();
        var request = new RegisterRequest("duplicate@example.com", "Password123!");

        // Register first time
        await client.PostAsJsonAsync("/api/auth/register", request);

        // Act - Register second time with same email
        var response = await client.PostAsJsonAsync("/api/auth/register", request);

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var error = await response.Content.ReadFromJsonAsync<ErrorResponse>();
        error.Should().NotBeNull();
        error!.Code.Should().Be("AUTH_002");
    }

    [Fact]
    public async Task Login_WithValidCredentials_ReturnsToken()
    {
        // Arrange
        var client = _factory.CreateClient();
        var email = "login@example.com";
        var password = "Password123!";

        // Register user first
        await client.PostAsJsonAsync("/api/auth/register", 
            new RegisterRequest(email, password));

        // Act
        var response = await client.PostAsJsonAsync("/api/auth/login", 
            new LoginRequest(email, password));

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var result = await response.Content.ReadFromJsonAsync<LoginResponse>();
        result.Should().NotBeNull();
        result!.Token.Should().NotBeNullOrEmpty();
        result.UserId.Should().NotBeEmpty();
    }

    [Fact]
    public async Task Login_WithInvalidPassword_ReturnsUnauthorized()
    {
        // Arrange
        var client = _factory.CreateClient();
        var email = "wrongpass@example.com";
        var password = "Password123!";

        // Register user first
        await client.PostAsJsonAsync("/api/auth/register", 
            new RegisterRequest(email, password));

        // Act - Login with wrong password
        var response = await client.PostAsJsonAsync("/api/auth/login", 
            new LoginRequest(email, "WrongPassword!"));

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        var error = await response.Content.ReadFromJsonAsync<ErrorResponse>();
        error.Should().NotBeNull();
        error!.Code.Should().Be("AUTH_001");
    }

    [Fact]
    public async Task Login_WithNonExistentUser_ReturnsUnauthorized()
    {
        // Arrange
        var client = _factory.CreateClient();

        // Act
        var response = await client.PostAsJsonAsync("/api/auth/login", 
            new LoginRequest("nonexistent@example.com", "Password123!"));

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        var error = await response.Content.ReadFromJsonAsync<ErrorResponse>();
        error.Should().NotBeNull();
        error!.Code.Should().Be("AUTH_001");
    }

    [Fact]
    public async Task GoogleAuth_WithValidToken_ReturnsToken()
    {
        // Arrange
        var client = _factory.CreateClient();
        var request = new GoogleAuthRequest("valid-google-token");

        // Act
        var response = await client.PostAsJsonAsync("/api/auth/google", request);

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var result = await response.Content.ReadFromJsonAsync<GoogleAuthResponse>();
        result.Should().NotBeNull();
        result!.Token.Should().NotBeNullOrEmpty();
        result.UserId.Should().NotBeEmpty();
        result.IsNewUser.Should().BeTrue();
    }

    [Fact]
    public async Task GoogleAuth_WithExistingUser_ReturnsTokenAndNotNewUser()
    {
        // Arrange
        var client = _factory.CreateClient();
        var request = new GoogleAuthRequest("valid-google-token");

        // First authentication (creates user)
        await client.PostAsJsonAsync("/api/auth/google", request);

        // Act - Second authentication (existing user)
        var response = await client.PostAsJsonAsync("/api/auth/google", request);

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var result = await response.Content.ReadFromJsonAsync<GoogleAuthResponse>();
        result.Should().NotBeNull();
        result!.Token.Should().NotBeNullOrEmpty();
        result.UserId.Should().NotBeEmpty();
        result.IsNewUser.Should().BeFalse();
    }

    [Fact]
    public async Task GoogleAuth_WithInvalidToken_ReturnsUnauthorized()
    {
        // Arrange
        var client = _factory.CreateClient();
        var request = new GoogleAuthRequest("invalid-google-token");

        // Act
        var response = await client.PostAsJsonAsync("/api/auth/google", request);

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        var error = await response.Content.ReadFromJsonAsync<ErrorResponse>();
        error.Should().NotBeNull();
        error!.Code.Should().Be("AUTH_003");
    }
}

/// <summary>
/// Mock Google token validator for testing.
/// Returns valid user info for "valid-google-token", null otherwise.
/// </summary>
internal class MockGoogleTokenValidator : IGoogleTokenValidator
{
    public Task<GoogleUserInfo?> ValidateTokenAsync(string token, CancellationToken ct = default)
    {
        if (token == "valid-google-token")
        {
            return Task.FromResult<GoogleUserInfo?>(
                new GoogleUserInfo("google-123", "googleuser@example.com"));
        }

        return Task.FromResult<GoogleUserInfo?>(null);
    }
}
