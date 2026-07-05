using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using PitchMate.Api.Auth;

namespace PitchMate.Api.Tests.Auth.Startup;

/// <summary>
/// Smoke test for the composition-root fail-fast contract of <c>AddAuth</c>. The auth use cases and
/// EF Core repositories depend on the shared persistence services that <c>AddInfrastructure</c>
/// registers (the <c>PitchMateDbContext</c>, the unit of work, and the generic repository). When
/// <c>AddAuth</c> is applied <em>without</em> that Infrastructure registration, validating the
/// container on build must fail rather than deferring the error to first request — and the failure
/// must name the missing service so an operator can see what is unwired.
/// <para>Validates: Requirement 12.6.</para>
/// </summary>
public sealed class AuthDependencyValidationSmokeTests
{
    // A complete, valid Auth configuration so the options binding is well-formed; the point of the
    // test is the missing Infrastructure registration, not a configuration error.
    private static IConfiguration ValidAuthConfiguration() =>
        new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Auth:Token:SigningKey"] = "smoke-tests-signing-key-that-is-at-least-32-bytes-000000",
                ["Auth:Token:Issuer"] = "https://smoke.pitch-mate.local",
                ["Auth:Token:Audience"] = "pitchmate-smoke",
                ["Auth:Token:AccessTokenLifetime"] = "00:15:00",
                ["Auth:Token:RefreshTokenLifetime"] = "30.00:00:00",
                ["Auth:Google:ClientId"] = "smoke.apps.googleusercontent.com",
                ["Auth:Email:Provider"] = "Console",
                ["Auth:EmailVerification:TokenLifetime"] = "1.00:00:00",
                ["Auth:PasswordReset:TokenLifetime"] = "00:30:00",
                ["Auth:PasswordReset:RateLimitWindow"] = "01:00:00",
                ["Auth:PasswordReset:MaxRequestsPerWindow"] = "5",
            })
            .Build();

    // Requirement 12.6 — a missing Infrastructure registration fails ValidateOnBuild naming the service.
    [Fact]
    public void ValidateOnBuildFailsNamingTheMissingInfrastructureService()
    {
        var services = new ServiceCollection();
        services.AddLogging();

        // AddAuth wires the use cases and the Infrastructure implementations of the auth
        // abstractions, but it deliberately does NOT register the shared persistence services it
        // builds on — those come from AddInfrastructure, which is omitted here.
        services.AddAuth(ValidAuthConfiguration());

        var exception = Assert.Throws<AggregateException>(() =>
            services.BuildServiceProvider(new ServiceProviderOptions
            {
                ValidateOnBuild = true,
                ValidateScopes = true,
            }));

        // The validation failure identifies an unresolvable Infrastructure prerequisite: the
        // DbContext (or a service that depends on it, such as the unit of work / generic repository /
        // clock) that AddInfrastructure would have supplied.
        string[] infrastructureServiceNames =
        [
            "PitchMateDbContext",
            "IUnitOfWork",
            "IRepository",
            "TimeProvider",
        ];

        Assert.Contains(
            exception.InnerExceptions,
            inner => infrastructureServiceNames.Any(name => inner.Message.Contains(name, StringComparison.Ordinal)));
    }
}
