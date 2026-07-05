using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.Extensions.Options;

namespace PitchMate.Api.Auth;

/// <summary>
/// Registers JWT bearer authentication and authorization for the Api. The bearer scheme's
/// <c>TokenValidationParameters</c> are built from the same validated <c>AuthTokenOptions</c> as the
/// token service (see <see cref="ConfigureJwtBearerOptions"/>), so a request the token service would
/// reject is rejected identically by the middleware, and vice versa (Requirement 13.4).
/// </summary>
public static class JwtBearerAuthenticationExtensions
{
    /// <summary>
    /// Adds the JWT bearer authentication handler (the default <c>Bearer</c> scheme) and the
    /// authorization services that back <c>RequireAuthorization()</c>. The scheme is configured lazily
    /// from the validated <c>AuthTokenOptions</c> via a DI-activated options configurator.
    /// </summary>
    /// <param name="services">The service collection to add registrations to.</param>
    /// <returns>The same <paramref name="services"/> for chaining.</returns>
    public static IServiceCollection AddJwtBearerAuthentication(this IServiceCollection services)
    {
        ArgumentNullException.ThrowIfNull(services);

        services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
            .AddJwtBearer();

        // Bind the bearer options to the validated AuthTokenOptions and the injected clock. Registered
        // as a DI-activated configurator so it can consume IOptions<AuthTokenOptions> and TimeProvider.
        services.AddSingleton<IConfigureOptions<JwtBearerOptions>, ConfigureJwtBearerOptions>();

        services.AddAuthorization();

        return services;
    }
}
