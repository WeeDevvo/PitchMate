using System.Collections.Generic;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Time.Testing;
using PitchMate.Api.Auth.Endpoints;
using PitchMate.Infrastructure.Persistence;
using Testcontainers.PostgreSql;

namespace PitchMate.Api.Tests.Auth;

/// <summary>
/// Boots the real <c>PitchMate.Api</c> host in-memory via <see cref="WebApplicationFactory{TEntryPoint}"/>
/// against a throwaway PostgreSQL container (Testcontainers), so the public-versus-protected routing
/// tests exercise the actual JWT bearer pipeline, authorization policies, and endpoint mappings rather
/// than mocks. The generic entry-point marker is a public Api type (<see cref="AuthEndpoints"/>) so the
/// factory locates the Api assembly's minimal-hosting entry point without needing the auto-generated
/// <c>Program</c> to be public. The marker (<see cref="LinkExternalProviderRequest"/>) is used only to
/// identify the Api assembly.
/// <para>
/// The factory supplies a complete, valid <c>Auth</c> configuration (so the fail-fast options
/// validation at startup passes) pointing at the container, substitutes a controllable
/// <see cref="FakeTimeProvider"/> for the clock, and applies the EF Core migrations against the
/// container so every endpoint — including the ones that touch persistence — is fully functional.
/// </para>
/// </summary>
public sealed class RoutingApiFactory : WebApplicationFactory<LinkExternalProviderRequest>, IAsyncLifetime
{
    // Pinned image version, matching the Infrastructure test fixture (steering: pin versions).
    private const string PostgreSqlImage = "postgres:17.2";

    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder(PostgreSqlImage)
        .WithDatabase("pitchmate_api_tests")
        .WithUsername("pitchmate")
        .WithPassword("pitchmate")
        .Build();

    /// <summary>The controllable clock the host uses, so token/expiry behaviour is deterministic.</summary>
    public FakeTimeProvider Clock { get; } = new();

    /// <summary>Opens a DI scope backed by the running host, for seeding and inspecting persisted state.</summary>
    public IServiceScope CreateScope() => Services.CreateScope();

    /// <inheritdoc />
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        // A complete, valid Auth configuration so ValidateOnStart() passes and startup succeeds. The
        // signing key is a throwaway test value (>= 32 bytes for HMAC-SHA256), never a real secret.
        builder.ConfigureAppConfiguration((_, config) =>
            config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:Default"] = _container.GetConnectionString(),
                ["Auth:Token:SigningKey"] = "routing-tests-signing-key-that-is-at-least-32-bytes-long-000000",
                ["Auth:Token:Issuer"] = "https://tests.pitch-mate.local",
                ["Auth:Token:Audience"] = "pitchmate-routing-tests",
                ["Auth:Token:AccessTokenLifetime"] = "00:15:00",
                ["Auth:Token:RefreshTokenLifetime"] = "30.00:00:00",
                ["Auth:Google:ClientId"] = "routing-tests.apps.googleusercontent.com",
                ["Auth:Email:Provider"] = "Console",
                ["Auth:Email:FromAddress"] = "no-reply@pitch-mate.local",
                ["Auth:Email:MaxTransientRetries"] = "3",
                ["Auth:EmailVerification:TokenLifetime"] = "1.00:00:00",
                ["Auth:PasswordReset:TokenLifetime"] = "00:30:00",
                ["Auth:PasswordReset:RateLimitWindow"] = "01:00:00",
                ["Auth:PasswordReset:MaxRequestsPerWindow"] = "5",
                ["Auth:SignInProtection:RequireVerifiedEmail"] = "false",
                ["Auth:SignInProtection:LockoutEnabled"] = "false",
                ["Auth:SignInProtection:MaxFailedAttempts"] = "10",
                ["Auth:SignInProtection:LockoutWindow"] = "00:15:00",
            }));

        builder.ConfigureTestServices(services =>
        {
            // Repoint the DbContext at the container. The production connection string is read
            // eagerly in Program.cs (AddInfrastructure) before the factory's configuration override
            // merges, so the registration itself must be replaced here (this runs after the app's
            // own registrations). The Auth options bind lazily and already pick up the in-memory
            // configuration above.
            services.RemoveAll<DbContextOptions<PitchMateDbContext>>();
            services.RemoveAll<DbContextOptions>();
            services.RemoveAll<PitchMateDbContext>();
            services.AddDbContext<PitchMateDbContext>(options =>
                options.UseNpgsql(_container.GetConnectionString())
                       .UseSnakeCaseNamingConvention());

            // Substitute the deterministic clock for the host's TimeProvider (registered TryAdd in
            // Infrastructure), so issuance and expiry are judged against a controllable instant.
            services.RemoveAll<TimeProvider>();
            services.AddSingleton<TimeProvider>(Clock);
        });
    }

    /// <summary>Starts the container and applies the EF Core migrations against it.</summary>
    async Task IAsyncLifetime.InitializeAsync()
    {
        await _container.StartAsync();

        // Building a scope forces host construction, which reads the container connection string
        // configured above. Apply migrations so persistence-touching endpoints are fully functional.
        using var scope = CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<PitchMateDbContext>();
        await db.Database.MigrateAsync();
    }

    /// <summary>Disposes the host and stops the container.</summary>
    async Task IAsyncLifetime.DisposeAsync()
    {
        await base.DisposeAsync();
        await _container.DisposeAsync();
    }
}
