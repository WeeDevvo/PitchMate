using System.Reflection;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using PitchMate.Application.Common.Persistence;
using PitchMate.Infrastructure;
using PitchMate.Infrastructure.Persistence;

namespace PitchMate.Infrastructure.Tests.Persistence;

/// <summary>
/// Integration tests for the dependency-injection wiring performed by
/// <see cref="DependencyInjection.AddInfrastructure"/>. They build a real
/// <see cref="ServiceProvider"/> and assert that the Application-layer persistence
/// abstractions resolve to their Infrastructure implementations, that the registrations
/// are scoped (one instance per scope, distinct across scopes), that the repository and
/// unit-of-work in a scope share one <see cref="PitchMateDbContext"/>, and that
/// <c>ValidateOnBuild</c> fails fast when a required registration is missing.
/// <para>
/// These tests never open a database connection: resolving and inspecting scoped services
/// (and validating the provider) constructs the <see cref="PitchMateDbContext"/> but does not
/// connect, so no Testcontainers/Docker dependency is needed. A placeholder connection string
/// satisfies the Npgsql registration without ever being used.
/// </para>
/// <para>Validates: Requirements 7.2, 7.3, 7.4, 7.6.</para>
/// </summary>
public sealed class DependencyInjectionWiringTests
{
    private const string PlaceholderConnectionString =
        "Host=localhost;Database=pitchmate;Username=test;Password=test";

    // Requirement 7.3 — resolving the Application interfaces yields the Infrastructure implementations.
    /// <summary>
    /// Resolving <see cref="IRepository{T}"/> yields an <see cref="EfRepository{T}"/> and resolving
    /// <see cref="IUnitOfWork"/> yields a <see cref="UnitOfWork"/>.
    /// </summary>
    [Fact]
    public void ResolvesApplicationAbstractionsToInfrastructureImplementations()
    {
        using var provider = BuildProvider();
        using var scope = provider.CreateScope();

        var repository = scope.ServiceProvider.GetRequiredService<IRepository<PersistenceTestEntity>>();
        var unitOfWork = scope.ServiceProvider.GetRequiredService<IUnitOfWork>();

        Assert.IsType<EfRepository<PersistenceTestEntity>>(repository);
        Assert.IsType<UnitOfWork>(unitOfWork);
    }

    // Requirement 7.2 — the registrations declare scoped lifetimes on the service collection.
    /// <summary>
    /// The open-generic <see cref="IRepository{T}"/>, the <see cref="IUnitOfWork"/>, and the
    /// <see cref="PitchMateDbContext"/> are all registered with the scoped lifetime.
    /// </summary>
    [Fact]
    public void RegistersPersistenceServicesAsScoped()
    {
        var services = BuildServices();

        var repositoryDescriptor = Assert.Single(
            services, d => d.ServiceType == typeof(IRepository<>));
        var unitOfWorkDescriptor = Assert.Single(
            services, d => d.ServiceType == typeof(IUnitOfWork));
        var dbContextDescriptor = Assert.Single(
            services, d => d.ServiceType == typeof(PitchMateDbContext));

        Assert.Equal(ServiceLifetime.Scoped, repositoryDescriptor.Lifetime);
        Assert.Equal(ServiceLifetime.Scoped, unitOfWorkDescriptor.Lifetime);
        Assert.Equal(ServiceLifetime.Scoped, dbContextDescriptor.Lifetime);
    }

    // Requirement 7.2 — scoped behaviour: one instance per scope, distinct instances across scopes.
    /// <summary>
    /// Resolving the same persistence service twice within one scope returns the same instance,
    /// while resolving it in a different scope returns a different instance.
    /// </summary>
    [Fact]
    public void ScopedServicesAreSharedWithinAScopeAndDistinctAcrossScopes()
    {
        using var provider = BuildProvider();

        IRepository<PersistenceTestEntity> repositoryA1;
        IRepository<PersistenceTestEntity> repositoryA2;
        IUnitOfWork unitOfWorkA1;
        IUnitOfWork unitOfWorkA2;

        using (var scopeA = provider.CreateScope())
        {
            repositoryA1 = scopeA.ServiceProvider.GetRequiredService<IRepository<PersistenceTestEntity>>();
            repositoryA2 = scopeA.ServiceProvider.GetRequiredService<IRepository<PersistenceTestEntity>>();
            unitOfWorkA1 = scopeA.ServiceProvider.GetRequiredService<IUnitOfWork>();
            unitOfWorkA2 = scopeA.ServiceProvider.GetRequiredService<IUnitOfWork>();

            // Same instance when resolved twice in the same scope.
            Assert.Same(repositoryA1, repositoryA2);
            Assert.Same(unitOfWorkA1, unitOfWorkA2);
        }

        using var scopeB = provider.CreateScope();
        var repositoryB = scopeB.ServiceProvider.GetRequiredService<IRepository<PersistenceTestEntity>>();
        var unitOfWorkB = scopeB.ServiceProvider.GetRequiredService<IUnitOfWork>();

        // Different instances across scopes.
        Assert.NotSame(repositoryA1, repositoryB);
        Assert.NotSame(unitOfWorkA1, unitOfWorkB);
    }

    // Requirement 7.4 — repository and unit-of-work in a scope share one DbContext; scopes differ.
    /// <summary>
    /// Within a single scope, the <see cref="PitchMateDbContext"/> backing the resolved
    /// <see cref="IRepository{T}"/> and <see cref="IUnitOfWork"/> is the very same instance that the
    /// scope resolves directly, so a save through the unit of work commits changes staged through the
    /// repository. Across different scopes the backing contexts differ.
    /// </summary>
    [Fact]
    public void RepositoryAndUnitOfWorkShareOneDbContextPerScope()
    {
        using var provider = BuildProvider();

        PitchMateDbContext scopeAContext;
        using (var scopeA = provider.CreateScope())
        {
            var repository = scopeA.ServiceProvider.GetRequiredService<IRepository<PersistenceTestEntity>>();
            var unitOfWork = scopeA.ServiceProvider.GetRequiredService<IUnitOfWork>();
            scopeAContext = scopeA.ServiceProvider.GetRequiredService<PitchMateDbContext>();

            var repositoryContext = GetBackingContext(repository);
            var unitOfWorkContext = GetBackingContext(unitOfWork);

            // Both implementations were injected with the scope's single shared context instance.
            Assert.Same(scopeAContext, repositoryContext);
            Assert.Same(scopeAContext, unitOfWorkContext);
        }

        using var scopeB = provider.CreateScope();
        var scopeBContext = scopeB.ServiceProvider.GetRequiredService<PitchMateDbContext>();

        // A different scope gets a different context instance.
        Assert.NotSame(scopeAContext, scopeBContext);
    }

    // Requirement 7.6 — a missing required registration fails when the provider is validated on build.
    /// <summary>
    /// With <c>ValidateOnBuild</c> (and <c>ValidateScopes</c>) enabled, building the provider throws
    /// when a registration the <see cref="PitchMateDbContext"/> depends on is missing — here the
    /// <see cref="TimeProvider"/> clock is removed after registration, so the context can no longer be
    /// constructed and validation fails at build time rather than at first resolve.
    /// </summary>
    [Fact]
    public void ValidateOnBuildFailsWhenARequiredRegistrationIsMissing()
    {
        var services = BuildServices();

        // Remove a dependency the DbContext's constructor requires.
        services.RemoveAll<TimeProvider>();

        var exception = Assert.Throws<AggregateException>(() =>
            services.BuildServiceProvider(new ServiceProviderOptions
            {
                ValidateOnBuild = true,
                ValidateScopes = true,
            }));

        // The validation failure identifies the unconstructable service / missing dependency.
        Assert.Contains(
            exception.InnerExceptions,
            inner => inner.Message.Contains(nameof(TimeProvider))
                || inner.Message.Contains(nameof(PitchMateDbContext)));
    }

    /// <summary>
    /// Builds the service collection exactly as production does via
    /// <see cref="DependencyInjection.AddInfrastructure"/>, using an in-memory configuration that
    /// supplies the required <c>ConnectionStrings:Default</c> placeholder.
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

    /// <summary>
    /// Reads the <see cref="PitchMateDbContext"/> a service was injected with, located by field type
    /// so the lookup is independent of the compiler-generated backing-field name for the primary
    /// constructor parameter.
    /// </summary>
    private static PitchMateDbContext GetBackingContext(object service)
    {
        var field = service.GetType()
            .GetFields(BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public)
            .Single(f => typeof(PitchMateDbContext).IsAssignableFrom(f.FieldType));

        return (PitchMateDbContext)field.GetValue(service)!;
    }
}
