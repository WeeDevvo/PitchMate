using System.Reflection;
using Microsoft.EntityFrameworkCore;
using PitchMate.Application.Notifications;
using PitchMate.Domain.Common;
using PitchMate.Domain.Notifications;
using PitchMate.Infrastructure.Notifications;

namespace PitchMate.Api.Tests.Architecture;

/// <summary>
/// Architecture / dependency-rule tests enforcing the Clean Architecture layering of the notifications
/// subsystem on every <c>dotnet test</c> run, so the placement of notification logic cannot regress
/// unnoticed (Requirement 13).
///
/// Complements <c>PitchMate.Infrastructure.Tests.Architecture.NotificationArchitecturePlacementTests</c>:
/// that suite proves the inner layers (Domain/Application/Infrastructure) hold the entity, enums, use
/// cases, abstractions, and implementations in the right place; this suite (which can see the
/// <c>PitchMate.Api</c> assembly) proves the rule that requires the Api assembly to assert — that the Api
/// holds only DI wiring and endpoint mapping and contains no notification entity definitions, use-case
/// implementations, repository implementations, or EF Core mappings (Req 13.4), keeping the inward-only
/// dependency rule enforceable (Req 13.5).
///
/// The approach is dependency-free (<see cref="System.Reflection"/> only): scanning concrete types catches
/// a mis-placed implementation, and positive checks confirm the notification abstractions are implemented
/// in Infrastructure/Application rather than the Api.
/// </summary>
public class NotificationLayeringAndImplementationLocationTests
{
    private const string DomainName = "PitchMate.Domain";
    private const string ApplicationName = "PitchMate.Application";
    private const string InfrastructureName = "PitchMate.Infrastructure";
    private const string ApiName = "PitchMate.Api";

    private const string ApiNotificationNamespace = "PitchMate.Api.Notifications";

    // Anchor types create a hard compile-time and runtime link to each asserted assembly, so a build with a
    // renamed/missing assembly fails to compile rather than passing this suite silently.
    private static readonly Assembly DomainAssembly = typeof(InAppNotification).Assembly;
    private static readonly Assembly ApplicationAssembly = typeof(INotificationPublisher).Assembly;
    private static readonly Assembly InfrastructureAssembly = typeof(NotificationEmailRenderer).Assembly;
    private static readonly Assembly ApiAssembly = typeof(Program).Assembly;

    /// <summary>The notification abstractions whose implementations must live in the inner layers, never in Api.</summary>
    private static readonly Type[] NotificationAbstractions =
    {
        typeof(INotificationPublisher),
        typeof(INotificationEmailRenderer),
        typeof(INotificationRepository),
    };

    /// <summary>The abstractions whose implementation the Api relies on Infrastructure to provide (Req 13.3).</summary>
    private static readonly Type[] InfrastructureBackedAbstractions =
    {
        typeof(INotificationEmailRenderer),
        typeof(INotificationRepository),
    };

    [Fact]
    public void AssertedAssembliesAreTheExpectedProjects()
    {
        // Guard against an anchor type drifting into the wrong assembly, which would make the remaining
        // assertions inspect the wrong project and pass misleadingly.
        Assert.Equal(DomainName, DomainAssembly.GetName().Name);
        Assert.Equal(ApplicationName, ApplicationAssembly.GetName().Name);
        Assert.Equal(InfrastructureName, InfrastructureAssembly.GetName().Name);
        Assert.Equal(ApiName, ApiAssembly.GetName().Name);
    }

    [Fact]
    public void NotificationAbstractions_AreImplementedInInfrastructure()
    {
        // Requirement 13.3 — the repository and email renderer each have a concrete implementation in
        // Infrastructure satisfying the Application abstraction.
        var missing = InfrastructureBackedAbstractions
            .Where(abstraction => !ConcreteImplementationsIn(InfrastructureAssembly, abstraction).Any())
            .Select(abstraction => abstraction.Name)
            .ToList();

        Assert.True(
            missing.Count == 0,
            $"{InfrastructureName} must contain a concrete implementation of each notification abstraction " +
            $"(Requirement 13.3). Missing: {Describe(missing)}.");
    }

    [Fact]
    public void NotificationAbstractions_AreNotImplementedInApi()
    {
        // Requirement 13.4 — the publisher, renderer, and repository implementations stay out of the Api;
        // the Api only wires them up and maps endpoints.
        var offenders = NotificationAbstractions
            .SelectMany(abstraction =>
                ConcreteImplementationsIn(ApiAssembly, abstraction)
                    .Select(impl => $"{impl.FullName} implements {abstraction.Name}"))
            .ToList();

        Assert.True(
            offenders.Count == 0,
            $"{ApiName} must contain no notification publisher/renderer/repository implementation " +
            $"(Requirement 13.4). Offenders: {Describe(offenders)}.");
    }

    [Fact]
    public void Api_ContainsNoNotificationEntityDefinitions()
    {
        // Requirement 13.4 — the InAppNotification entity is defined in Domain; the Api defines none. Any
        // BaseEntity subclass residing in the Api notification namespace is a mis-placed entity definition.
        var offenders = LoadableTypes(ApiAssembly)
            .Where(type => type is { IsClass: true, IsAbstract: false }
                           && typeof(BaseEntity).IsAssignableFrom(type)
                           && (type.Namespace?.StartsWith(ApiNotificationNamespace, StringComparison.Ordinal) ?? false))
            .Select(type => type.FullName!)
            .ToList();

        Assert.True(
            offenders.Count == 0,
            $"{ApiName} must contain no notification entity definitions (Requirement 13.4). " +
            $"Offenders: {Describe(offenders)}.");
    }

    [Fact]
    public void Api_ContainsNoNotificationEfMappings()
    {
        // Requirement 13.4 — the InAppNotification EF Core mapping is an Infrastructure concern; the Api
        // declares none.
        var offenders = LoadableTypes(ApiAssembly)
            .Where(type => type is { IsClass: true, IsAbstract: false } && ImplementsNotificationConfiguration(type))
            .Select(type => type.FullName!)
            .ToList();

        Assert.True(
            offenders.Count == 0,
            $"{ApiName} must contain no notification EF Core IEntityTypeConfiguration<InAppNotification> " +
            $"mapping (Requirement 13.4). Offenders: {Describe(offenders)}.");
    }

    [Fact]
    public void Api_ContainsNoNotificationUseCaseImplementations()
    {
        // Requirement 13.4 — notification use cases (handlers) live in Application; the Api only maps
        // endpoints onto them. No *Handler type may appear in the Api notification namespace.
        var offenders = LoadableTypes(ApiAssembly)
            .Where(type => type is { IsClass: true, IsAbstract: false })
            .Where(type => (type.Namespace?.StartsWith(ApiNotificationNamespace, StringComparison.Ordinal) ?? false)
                           && type.Name.EndsWith("Handler", StringComparison.Ordinal))
            .Select(type => type.FullName!)
            .ToList();

        Assert.True(
            offenders.Count == 0,
            $"{ApiName} must contain no notification use-case implementations (Requirement 13.4). " +
            $"Offenders: {Describe(offenders)}.");
    }

    private static bool ImplementsNotificationConfiguration(Type type) =>
        type.GetInterfaces().Any(i =>
            i.IsGenericType
            && i.GetGenericTypeDefinition() == typeof(IEntityTypeConfiguration<>)
            && i.GetGenericArguments()[0] == typeof(InAppNotification));

    private static IEnumerable<Type> ConcreteImplementationsIn(Assembly assembly, Type abstraction) =>
        LoadableTypes(assembly)
            .Where(type => type is { IsClass: true, IsAbstract: false } && abstraction.IsAssignableFrom(type));

    private static IEnumerable<Type> LoadableTypes(Assembly assembly)
    {
        try
        {
            return assembly.GetTypes();
        }
        catch (ReflectionTypeLoadException ex)
        {
            return ex.Types.Where(type => type is not null).Select(type => type!);
        }
    }

    private static string Describe(IReadOnlyCollection<string> offenders) =>
        offenders.Count == 0 ? "(none)" : string.Join("; ", offenders);
}
