using System.Net;
using System.Net.Http.Headers;
using FluentAssertions;
using FsCheck;
using FsCheck.Xunit;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using PitchMate.Infrastructure.Data;

namespace PitchMate.API.Tests.Properties;

/// <summary>
/// Property-based tests for API authentication enforcement.
/// Validates that protected endpoints require valid authentication tokens.
/// </summary>
public class AuthenticationProperties : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public AuthenticationProperties(WebApplicationFactory<Program> factory)
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
                    options.UseInMemoryDatabase("TestDatabase_Auth_" + Guid.NewGuid());
                });
            });
        });
    }

    /// <summary>
    /// Feature: pitchmate-core, Property 34: Authentication enforcement
    /// For any protected API endpoint, requests without valid authentication tokens should be rejected with 401 Unauthorized.
    /// **Validates: Requirements 8.2**
    /// </summary>
    [Property(MaxTest = 100)]
    public void ProtectedEndpointsRequireAuthentication(NonEmptyString tokenSeed)
    {
        // Arrange
        var client = _factory.CreateClient();
        var invalidToken = GenerateInvalidToken(tokenSeed.Get);
        
        // Add invalid token
        if (!string.IsNullOrEmpty(invalidToken))
        {
            client.DefaultRequestHeaders.Authorization = 
                new AuthenticationHeaderValue("Bearer", invalidToken);
        }

        // Act
        var response = client.GetAsync("/api/test/protected").Result;

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    /// <summary>
    /// Property: Public endpoints should not require authentication
    /// For any public API endpoint, requests without authentication tokens should succeed.
    /// </summary>
    [Property(MaxTest = 100)]
    public void PublicEndpointsDoNotRequireAuthentication(NonEmptyString tokenSeed)
    {
        // Arrange
        var client = _factory.CreateClient();
        var invalidToken = GenerateInvalidToken(tokenSeed.Get);
        
        // Add invalid or missing token (should not matter for public endpoints)
        if (!string.IsNullOrEmpty(invalidToken))
        {
            client.DefaultRequestHeaders.Authorization = 
                new AuthenticationHeaderValue("Bearer", invalidToken);
        }

        // Act
        var response = client.GetAsync("/api/test/public").Result;

        // Assert
        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    /// <summary>
    /// Generates various invalid token formats based on a seed string.
    /// Sanitizes the string to remove characters that aren't allowed in HTTP headers.
    /// </summary>
    private static string GenerateInvalidToken(string seed)
    {
        // Remove newlines and other control characters that aren't allowed in HTTP headers
        var sanitized = new string(seed.Where(c => !char.IsControl(c) || c == '\t').ToArray());
        
        if (string.IsNullOrWhiteSpace(sanitized))
        {
            sanitized = "invalid";
        }

        var hash = sanitized.GetHashCode();
        var variants = new[]
        {
            "",
            "not.a.jwt",
            "invalid",
            "Bearer token",
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid.signature",
            "a.b.c.d.e",
            sanitized.Substring(0, Math.Min(10, sanitized.Length))
        };

        return variants[Math.Abs(hash) % variants.Length];
    }
}
