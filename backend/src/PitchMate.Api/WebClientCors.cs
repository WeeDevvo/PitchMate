using Microsoft.AspNetCore.Cors.Infrastructure;
using Microsoft.Extensions.Options;

namespace PitchMate.Api;

/// <summary>
/// Cross-origin access for the deployed web client. In QA and production the static web app and the
/// Api are served from different origins, so the browser only lets the web client read Api responses
/// when the Api names the web client's origin. Locally the Vite dev server proxies the Api same-origin,
/// so no origin is configured and the policy admits none.
/// <para>
/// The allow-list is the <c>Cors:AllowedOrigins</c> configuration array (for example the environment
/// variable <c>Cors__AllowedOrigins__0</c>). It is read when the options are first resolved rather than
/// at registration, so a host's own settings — including a test host's — are honoured. Credentials are
/// deliberately not allowed: the client authenticates with a bearer header, never a cookie.
/// </para>
/// </summary>
public static class WebClientCors
{
    /// <summary>The configuration key holding the allowed web client origins.</summary>
    public const string AllowedOriginsKey = "Cors:AllowedOrigins";

    /// <summary>Registers the default CORS policy built from <see cref="AllowedOriginsKey"/>.</summary>
    public static IServiceCollection AddWebClientCors(this IServiceCollection services)
    {
        services.AddCors();
        services.AddOptions<CorsOptions>()
            .Configure<IConfiguration>((options, configuration) =>
            {
                string[] origins = configuration.GetSection(AllowedOriginsKey).Get<string[]>() ?? [];

                options.AddDefaultPolicy(policy => policy
                    .WithOrigins(origins)
                    .AllowAnyHeader()
                    .AllowAnyMethod());
            });

        return services;
    }
}
