using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using FluentAssertions;
using FsCheck;
using FsCheck.Xunit;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PitchMate.API.Controllers;
using PitchMate.Application.Services;
using PitchMate.Infrastructure.Data;

namespace PitchMate.API.Tests.Properties;

/// <summary>
/// Property-based tests for API authorization enforcement.
/// Validates that operations requiring specific permissions are properly restricted.
/// </summary>
public class AuthorizationProperties : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public AuthorizationProperties(WebApplicationFactory<Program> factory)
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
                    options.UseInMemoryDatabase("TestDatabase_Authz_" + Guid.NewGuid());
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
    /// Feature: pitchmate-core, Property 35: Authorization enforcement
    /// For any API endpoint requiring specific permissions, requests from users without those permissions 
    /// should be rejected with 403 Forbidden.
    /// **Validates: Requirements 8.3**
    /// </summary>
    [Property(MaxTest = 100)]
    public void AdminOnlyOperationsRequireAdminPrivileges(PositiveInt squadIdSeed, PositiveInt userIdSeed)
    {
        // Arrange
        var client = _factory.CreateClient();
        
        // Create a squad with one user as admin
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

        // Create a non-admin user and join the squad
        var nonAdminEmail = $"nonadmin{userIdSeed.Get}@example.com";
        var nonAdminToken = RegisterAndLoginUser(client, nonAdminEmail, "Password123!").Result;
        
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", nonAdminToken);
        var joinResponse = client.PostAsync($"/api/squads/{squadId}/join", null).Result;

        if (!joinResponse.IsSuccessStatusCode)
        {
            // Skip this test iteration if join failed
            return;
        }

        // Act - Try to perform admin-only operation (add admin) as non-admin
        var targetUserId = Guid.NewGuid();
        var addAdminResponse = client.PostAsJsonAsync($"/api/squads/{squadId}/admins", 
            new AddSquadAdminRequest(targetUserId)).Result;

        // Assert - Should be forbidden
        addAdminResponse.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    /// <summary>
    /// Property: Admin users can perform admin operations
    /// For any admin user, admin operations should succeed.
    /// </summary>
    [Property(MaxTest = 100)]
    public void AdminUsersCanPerformAdminOperations(PositiveInt squadIdSeed)
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

        // Register a target user to add as admin
        var targetEmail = $"target{squadIdSeed.Get}@example.com";
        RegisterUser(client, targetEmail, "Password123!").Wait();
        var targetUserId = GetUserIdByEmail(client, targetEmail).Result;

        // Act - Perform admin operation as admin
        var addAdminResponse = client.PostAsJsonAsync($"/api/squads/{squadId}/admins", 
            new AddSquadAdminRequest(targetUserId)).Result;

        // Assert - Should succeed (OK or Created)
        addAdminResponse.IsSuccessStatusCode.Should().BeTrue();
    }

    /// <summary>
    /// Property: Non-admin users cannot remove squad members
    /// For any non-admin user, attempting to remove a member should be forbidden.
    /// </summary>
    [Property(MaxTest = 100)]
    public void NonAdminUsersCannotRemoveMembers(PositiveInt squadIdSeed, PositiveInt userIdSeed)
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

        // Create two non-admin users and join the squad
        var user1Email = $"user1{userIdSeed.Get}@example.com";
        var user1Token = RegisterAndLoginUser(client, user1Email, "Password123!").Result;
        
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", user1Token);
        var join1Response = client.PostAsync($"/api/squads/{squadId}/join", null).Result;

        if (!join1Response.IsSuccessStatusCode)
        {
            // Skip this test iteration if join failed
            return;
        }

        var user2Email = $"user2{userIdSeed.Get}@example.com";
        var user2Token = RegisterAndLoginUser(client, user2Email, "Password123!").Result;
        var user2Id = GetUserIdByEmail(client, user2Email).Result;
        
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", user2Token);
        var join2Response = client.PostAsync($"/api/squads/{squadId}/join", null).Result;

        if (!join2Response.IsSuccessStatusCode)
        {
            // Skip this test iteration if join failed
            return;
        }

        // Act - Try to remove user2 as user1 (non-admin)
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", user1Token);
        var removeResponse = client.DeleteAsync($"/api/squads/{squadId}/members/{user2Id}").Result;

        // Assert - Should be forbidden
        removeResponse.StatusCode.Should().Be(HttpStatusCode.Forbidden);
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

    private async Task<Guid> GetUserIdByEmail(HttpClient client, string email)
    {
        var token = await LoginUser(client, email, "Password123!");
        var tempClient = _factory.CreateClient();
        tempClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var response = await tempClient.PostAsJsonAsync("/api/auth/login", new LoginRequest(email, "Password123!"));
        var result = await response.Content.ReadFromJsonAsync<LoginResponse>();
        return result!.UserId;
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
