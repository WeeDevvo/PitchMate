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
    // Environment variables are process-global, but xunit runs test collections in parallel, so two
    // classes can each hold their own factory at the same time. Without this count the first factory
    // to be disposed would clear the variables out from under a sibling factory whose host has not
    // been built yet, failing that host's startup. Every instance sets the same fixed values from
    // AuthApiTestConfig, so the variables are safe to leave in place until the last one goes away.
    //
    // Counting alone is not enough: "decrement, then clear" and "increment, then set" must not
    // interleave. A bare Interlocked pair leaves a window in which the last factory of one class
    // decrements to zero, a third class's factory then constructs and sets the variables, and the
    // first factory's clear runs afterwards — wiping the configuration out from under a host that has
    // not booted yet. That host then boots from appsettings.Development.json plus user-secrets
    // instead, so it starts cleanly but validates tokens against the wrong issuer/audience/key, and
    // every authenticated request answers as unauthenticated. Both halves therefore run under one
    // lock, and each instance decrements at most once (xunit may dispose a fixture through both the
    // sync and async paths).
    private static readonly object EnvironmentGate = new();
    private static int _liveInstances;

    private readonly List<string> _setEnvVarKeys = new();
    private bool _released;

    /// <summary>The fixed clock the running Api uses for token-lifetime validation.</summary>
    public FakeTimeProvider Clock { get; } = new(AuthApiTestConfig.FixedNow);

    /// <summary>
    /// Sets the test configuration as environment variables (configuration keys with <c>:</c> mapped to
    /// the <c>__</c> environment-variable separator) so it is present when the Api's host builder reads
    /// configuration at startup.
    /// </summary>
    public AuthApiFactory()
    {
        lock (EnvironmentGate)
        {
            _liveInstances++;

            foreach ((string key, string? value) in AuthApiTestConfig.Settings)
            {
                string envKey = key.Replace(":", "__", StringComparison.Ordinal);
                Environment.SetEnvironmentVariable(envKey, value);
                _setEnvVarKeys.Add(envKey);
            }
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
            lock (EnvironmentGate)
            {
                if (!_released)
                {
                    _released = true;

                    // Only the last live factory clears the shared variables (see EnvironmentGate).
                    if (--_liveInstances == 0)
                    {
                        foreach (string envKey in _setEnvVarKeys)
                        {
                            Environment.SetEnvironmentVariable(envKey, null);
                        }
                    }

                    _setEnvVarKeys.Clear();
                }
            }
        }

        base.Dispose(disposing);
    }
}
