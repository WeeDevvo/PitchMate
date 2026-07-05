using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Time.Testing;

namespace PitchMate.Api.Tests.Auth;

/// <summary>
/// Boots the real <c>PitchMate.Api</c> in-memory (via <see cref="WebApplicationFactory{TEntryPoint}"/>)
/// with the fixed valid <see cref="AuthApiTestConfig"/> and a <see cref="FakeTimeProvider"/> pinned to
/// <see cref="AuthApiTestConfig.FixedNow"/>. Injecting the fake clock makes the JWT bearer pipeline's
/// zero-skew lifetime check deterministic, so a forged "expired" token is judged against a clock the
/// test controls — exactly as the production <c>ConfigureJwtBearerOptions</c> does with the real clock.
/// <para>
/// The Api reads its connection string and <c>Auth</c> options from configuration eagerly during
/// <c>Program</c> startup (before the host is built), so the test configuration is supplied through
/// environment variables — the one configuration source the default host reads at
/// <c>WebApplication.CreateBuilder</c> time. They are set before the host boots and cleared on dispose.
/// </para>
/// </summary>
public sealed class AuthApiFactory : WebApplicationFactory<Program>
{
    private readonly List<string> _setEnvVarKeys = new();

    /// <summary>The fixed clock the running Api uses for token-lifetime validation.</summary>
    public FakeTimeProvider Clock { get; } = new(AuthApiTestConfig.FixedNow);

    /// <summary>
    /// Sets the test configuration as environment variables (configuration keys with <c>:</c> mapped to
    /// the <c>__</c> environment-variable separator) so it is present when the Api's host builder reads
    /// configuration at startup.
    /// </summary>
    public AuthApiFactory()
    {
        foreach ((string key, string? value) in AuthApiTestConfig.Settings)
        {
            string envKey = key.Replace(":", "__", StringComparison.Ordinal);
            Environment.SetEnvironmentVariable(envKey, value);
            _setEnvVarKeys.Add(envKey);
        }
    }

    /// <inheritdoc />
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        ArgumentNullException.ThrowIfNull(builder);

        // Replace the system clock with the pinned fake one. TimeProvider is registered with
        // TryAddSingleton in Infrastructure, so ConfigureTestServices (which runs last) wins.
        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<TimeProvider>();
            services.AddSingleton<TimeProvider>(Clock);
        });
    }

    /// <inheritdoc />
    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            foreach (string envKey in _setEnvVarKeys)
            {
                Environment.SetEnvironmentVariable(envKey, null);
            }

            _setEnvVarKeys.Clear();
        }

        base.Dispose(disposing);
    }
}
