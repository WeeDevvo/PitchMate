using System.Reflection;
using Microsoft.EntityFrameworkCore;
using PitchMate.Application.Squads;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Common;
using PitchMate.Domain.Squads;
using PitchMate.Infrastructure.Squads;

namespace PitchMate.Api.Tests.Architecture;

/// <summary>
/// Architecture / dependency-rule tests enforcing the Clean Architecture layering of the squad
/// subsystem on every <c>dotnet test</c> run, so the placement of squad logic cannot regress
/// unnoticed (Requirement 19).
///
/// Complements <c>PitchMate.Infrastructure.Tests.Architecture.SquadArchitecturePlacementTests</c>:
/// that suite proves the inner layers (Domain/Application/Infrastructure) hold the squad entities,
/// use cases, interfaces, and implementations in the right place; this suite (which can see the
/// <c>PitchMate.Api</c> assembly) proves the rule that requires the Api assembly to assert — that
/// the Api holds only DI wiring and endpoint mapping and contains no squad entity definitions,
/// use-case implementations, repository implementations, or EF Core mappings (Req 19.4), keeping
/// the inward-only dependency rule enforceable (Req 19.6).
///
/// The approach is dependency-free (<see cref="System.Reflection"/> only): scanning concrete types
/// catches a mis-placed implementation, and positive checks confirm the squad abstractions are
/// implemented in Infrastructure rather than the Api.
/// </summary>
public class SquadLayeringAndImplementationLocationTests
{
    private const string DomainName = "PitchMate.Domain";
    private const string ApplicationName = "PitchMate.Application";
    private const string InfrastructureName = "PitchMate.Infrastructure";
    private const string ApiName = "PitchMate.Api";

    // Anchor types create a hard compile-time and runtime link to each asserted assembly, so a build
    // with a renamed/missing assembly fails to compile rather than passing this suite silently.
    private static readonly Assembly DomainAssembly = typeof(Squad).Assembly;
    private static readonly Assembly ApplicationAssembly = typeof(ISquadRepository).Assembly;
    private static readonly Assembly InfrastructureAssembly = typeof(InviteSecretService).Assembly;
    private static readonly Assembly ApiAssembly = typeof(Program).Assembly;

    /// <summary>The squad abstractions whose implementations must live in Infrastructure, never in Api.</summary>
    private static readonly Type[] SquadInfrastructureAbstractions =
    {
        typeof(ISquadRepository),
        typeof(ISquadMembershipRepository),
        typeof(IInviteRepository),
        typeof(IGuestClaimRepository),
        typeof(IInviteSecretService),
        typeof(IMembershipHistoryProbe),
    };

    [Fact]
    public void AssertedAssembliesAreTheExpectedProjects()
    {
        // Guard against an anchor type drifting into the wrong assembly, which would make the
        // remaining assertions inspect the wrong project and pass misleadingly.
        Assert.Equal(DomainName, DomainAssembly.GetName().Name);
        Assert.Equal(ApplicationName, ApplicationAssembly.GetName().Name);
        Assert.Equal(InfrastructureName, InfrastructureAssembly.GetName().Name);
        Assert.Equal(ApiName, ApiAssembly.GetName().Name);
    }

    [Fact]
    public void SquadAbstractions_AreImplementedInInfrastructure()
    {
        // Requirements 10.7, 19.3 — each squad repository/lookup interface, the invite secret service,
        // and the membership-history probe have a concrete implementation in Infrastructure.
        var missing = SquadInfrastructureAbstractions
            .Where(abstraction => !ConcreteImplementationsIn(InfrastructureAssembly, abstraction).Any())
            .Select(abstraction => abstraction.Name)
            .ToList();

        Assert.True(
            missing.Count == 0,
            $"{InfrastructureName} must contain a concrete implementation of each squad abstraction " +
            $"(Requirements 10.7, 19.3). Missing: {Describe(missing)}.");
    }

    [Fact]
    public void SquadAbstractions_AreNotImplementedInApi()
    {
        // Requirement 19.4 — repository implementations, invite secret generation/hashing, and the
        // membership-history probe stay out of the Api project.
        var offenders = SquadInfrastructureAbstractions
            .SelectMany(abstraction =>
                ConcreteImplementationsIn(ApiAssembly, abstraction)
                    .Select(impl => $"{impl.FullName} implements {abstraction.Name}"))
            .ToList();

        Assert.True(
            offenders.Count == 0,
            $"{ApiName} must contain no squad repository/secret/probe implementation " +
            $"(Requirement 19.4). Offenders: {Describe(offenders)}.");
    }

    [Fact]
    public void Api_ContainsNoSquadEntityDefinitions()
    {
        // Requirement 19.4 — squad entities are defined in Domain; the Api holds none. Any BaseEntity
        // subclass in the Api assembly is a mis-placed entity definition.
        var offenders = LoadableTypes(ApiAssembly)
            .Where(type => type is { IsClass: true, IsAbstract: false }
                           && typeof(BaseEntity).IsAssignableFrom(type))
            .Select(type => type.FullName!)
            .ToList();

        Assert.True(
            offenders.Count == 0,
            $"{ApiName} must contain no entity definitions (Requirement 19.4). Offenders: {Describe(offenders)}.");
    }

    [Fact]
    public void Api_ContainsNoEfCoreMappings()
    {
        // Requirement 19.4 — EF Core mappings are an Infrastructure concern; the Api declares none.
        var offenders = LoadableTypes(ApiAssembly)
            .Where(type => type is { IsClass: true, IsAbstract: false } && ImplementsEntityConfiguration(type))
            .Select(type => type.FullName!)
            .ToList();

        Assert.True(
            offenders.Count == 0,
            $"{ApiName} must contain no EF Core IEntityTypeConfiguration<> mappings (Requirement 19.4). " +
            $"Offenders: {Describe(offenders)}.");
    }

    [Fact]
    public void Api_ContainsNoSquadUseCaseImplementations()
    {
        // Requirement 19.4 — squad use cases (handlers) live in Application; the Api only maps
        // endpoints onto them. No use-case namespace or *Handler type may appear in the Api assembly.
        var offenders = LoadableTypes(ApiAssembly)
            .Where(type => type is { IsClass: true, IsAbstract: false })
            .Where(type =>
                (type.Namespace?.Contains(".Squads.UseCases", StringComparison.Ordinal) ?? false)
                || ((type.Namespace?.StartsWith("PitchMate.Api.Squads", StringComparison.Ordinal) ?? false)
                    && type.Name.EndsWith("Handler", StringComparison.Ordinal)))
            .Select(type => type.FullName!)
            .ToList();

        Assert.True(
            offenders.Count == 0,
            $"{ApiName} must contain no squad use-case implementations (Requirement 19.4). " +
            $"Offenders: {Describe(offenders)}.");
    }

    private static bool ImplementsEntityConfiguration(Type type) =>
        type.GetInterfaces().Any(i =>
            i.IsGenericType && i.GetGenericTypeDefinition() == typeof(IEntityTypeConfiguration<>));

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
