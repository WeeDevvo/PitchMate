using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using PitchMate.Application.Stats;
using PitchMate.Infrastructure;
using PitchMate.Infrastructure.LiveTracking;
using PitchMate.Infrastructure.Squads;
using PitchMate.Infrastructure.Stats;

namespace PitchMate.Infrastructure.Tests.LiveTracking;

/// <summary>
/// DI seam-replacement test for the live-tracking rich-stats override. The stats registration seeds
/// <see cref="EmptyRichStatsSource"/> as the MVP no-data <see cref="IRichStatsSource"/>; the
/// live-tracking registration (invoked by <see cref="DependencyInjection.AddInfrastructure"/> after the
/// stats one) replaces that descriptor with the event-log-backed
/// <see cref="EventLogRichStatsSource"/>. This test builds the production service collection and asserts
/// that the type resolved for <see cref="IRichStatsSource"/> is <see cref="EventLogRichStatsSource"/> and
/// NOT <see cref="EmptyRichStatsSource"/> (Requirement 14.3).
/// <para>
/// This never opens a database connection: resolving the scoped <see cref="IRichStatsSource"/>
/// constructs its scoped dependencies (the DbContext-backed repositories) but does not connect, so no
/// Testcontainers/Docker dependency is needed. A placeholder connection string satisfies the Npgsql
/// registration without ever being used.
/// </para>
/// <para>Validates: Requirements 14.3.</para>
/// </summary>
public sealed class RichStatsSourceRegistrationTests
{
    private const string PlaceholderConnectionString =
        "Host=localhost;Database=pitchmate;Username=test;Password=test";

    // Requirement 14.3 — AddInfrastructure resolves the real event-log-backed rich-stats source.
    /// <summary>
    /// Resolving <see cref="IRichStatsSource"/> from the production registrations yields an
    /// <see cref="EventLogRichStatsSource"/>, not the MVP <see cref="EmptyRichStatsSource"/>.
    /// </summary>
    [Fact]
    public void AddInfrastructureResolvesRichStatsSourceToEventLogSource()
    {
        using var provider = BuildProvider();
        using var scope = provider.CreateScope();

        var richStatsSource = scope.ServiceProvider.GetRequiredService<IRichStatsSource>();

        Assert.IsType<EventLogRichStatsSource>(richStatsSource);
        Assert.IsNotType<EmptyRichStatsSource>(richStatsSource);
    }

    // Requirement 14.3 — exactly one IRichStatsSource descriptor remains, and it is the override.
    /// <summary>
    /// The service collection carries a single <see cref="IRichStatsSource"/> descriptor whose
    /// implementation type is <see cref="EventLogRichStatsSource"/>, confirming the live-tracking
    /// registration replaced (rather than appended to) the stats registration's
    /// <see cref="EmptyRichStatsSource"/> seed.
    /// </summary>
    [Fact]
    public void RichStatsSourceIsRegisteredOnceAsTheEventLogOverride()
    {
        var services = BuildServices();

        var descriptor = Assert.Single(
            services, d => d.ServiceType == typeof(IRichStatsSource));

        Assert.Equal(typeof(EventLogRichStatsSource), descriptor.ImplementationType);
        Assert.NotEqual(typeof(EmptyRichStatsSource), descriptor.ImplementationType);
    }

    /// <summary>
    /// Builds the service collection as production does via
    /// <see cref="DependencyInjection.AddInfrastructure"/>, using an in-memory configuration that
    /// supplies the required <c>ConnectionStrings:Default</c> placeholder.
    /// <para>
    /// <see cref="EventLogRichStatsSource"/> depends on <c>ISquadRepository</c>, which the squads
    /// composition root (<c>AddSquads</c> → <c>AddSquadsInfrastructure</c>) supplies in production
    /// alongside <c>AddInfrastructure</c>. This registers the squad Infrastructure the same way so the
    /// resolved-service assertion exercises the full override object graph, exactly as the running app
    /// constructs it.
    /// </para>
    /// </summary>
    private static IServiceCollection BuildServices()
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:Default"] = PlaceholderConnectionString,
            })
            .Build();

        var services = new ServiceCollection();
        services.AddInfrastructure(configuration);
        services.AddSquadsInfrastructure();
        return services;
    }

    /// <summary>
    /// Builds a validated, scope-checked provider from the production registrations.
    /// </summary>
    private static ServiceProvider BuildProvider() =>
        BuildServices().BuildServiceProvider(new ServiceProviderOptions
        {
            ValidateOnBuild = true,
            ValidateScopes = true,
        });
}
