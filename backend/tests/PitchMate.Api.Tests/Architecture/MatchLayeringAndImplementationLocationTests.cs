using System.Reflection;
using Microsoft.EntityFrameworkCore;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Domain.Common;
using PitchMate.Domain.Matches;
using PitchMate.Infrastructure.Matches;

namespace PitchMate.Api.Tests.Architecture;

/// <summary>
/// Architecture / dependency-rule tests enforcing the Clean Architecture layering of the
/// match-lifecycle subsystem on every <c>dotnet test</c> run, so the placement of match logic
/// cannot regress unnoticed and a violating reference fails the build (Requirement 16).
///
/// Complements <c>PitchMate.Infrastructure.Tests.Architecture.MatchArchitecturePlacementTests</c>:
/// that suite proves the inner layers (Domain/Application/Infrastructure) hold the match entities,
/// use cases, interfaces, and implementations in the right place (Req 16.1–16.3); this suite (which
/// can see the <c>PitchMate.Api</c> assembly) proves the rule that requires the Api assembly to
/// assert — that the Api holds only DI wiring and endpoint mapping and contains no match entity
/// definitions, use-case implementations, repository/balancer implementations, or EF Core mappings
/// (Req 16.4), keeping the inward-only dependency rule enforceable (Req 16.6).
///
/// Requirement 16.5 (the web, mobile, and watch clients never reference the Domain project and act
/// only via the API) is enforced by construction rather than by a runtime assertion: the clients are
/// TypeScript (web) and Swift (watch) / React Native (mobile) projects that cannot reference a .NET
/// assembly, and the only .NET client of the backend — <c>PitchMate.Api</c> — reaches match logic
/// solely through <c>PitchMate.Infrastructure</c> DI wiring, which the checks below confirm carries
/// no match implementation itself.
///
/// The approach is dependency-free (<see cref="System.Reflection"/> only): scanning concrete types
/// catches a mis-placed implementation, and positive checks confirm the match abstractions are
/// implemented in Infrastructure rather than the Api.
/// </summary>
public class MatchLayeringAndImplementationLocationTests
{
    private const string DomainName = "PitchMate.Domain";
    private const string ApplicationName = "PitchMate.Application";
    private const string InfrastructureName = "PitchMate.Infrastructure";
    private const string ApiName = "PitchMate.Api";

    // Anchor types create a hard compile-time and runtime link to each asserted assembly, so a build
    // with a renamed/missing assembly fails to compile rather than passing this suite silently.
    private static readonly Assembly DomainAssembly = typeof(Match).Assembly;
    private static readonly Assembly ApplicationAssembly = typeof(ITeamBalancer).Assembly;
    private static readonly Assembly InfrastructureAssembly = typeof(TeamBalancer).Assembly;
    private static readonly Assembly ApiAssembly = typeof(Program).Assembly;

    /// <summary>The match abstractions whose implementations must live in Infrastructure, never in Api.</summary>
    private static readonly Type[] MatchInfrastructureAbstractions =
    {
        typeof(ITeamBalancer),
        typeof(ISillyNameGenerator),
        typeof(IMatchRepository),
        typeof(IAvailabilityRepository),
        typeof(IMembershipRatingRepository),
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
    public void MatchAbstractions_AreImplementedInInfrastructure()
    {
        // Requirement 16.3 — each match repository interface, the team balancer, and the silly-name
        // generator have a concrete implementation in Infrastructure.
        var missing = MatchInfrastructureAbstractions
            .Where(abstraction => !ConcreteImplementationsIn(InfrastructureAssembly, abstraction).Any())
            .Select(abstraction => abstraction.Name)
            .ToList();

        Assert.True(
            missing.Count == 0,
            $"{InfrastructureName} must contain a concrete implementation of each match abstraction " +
            $"(Requirement 16.3). Missing: {Describe(missing)}.");
    }

    [Fact]
    public void MatchAbstractions_AreNotImplementedInApi()
    {
        // Requirement 16.4 — repository implementations, the team balancer, and the silly-name
        // generator stay out of the Api project.
        var offenders = MatchInfrastructureAbstractions
            .SelectMany(abstraction =>
                ConcreteImplementationsIn(ApiAssembly, abstraction)
                    .Select(impl => $"{impl.FullName} implements {abstraction.Name}"))
            .ToList();

        Assert.True(
            offenders.Count == 0,
            $"{ApiName} must contain no match repository/balancer/name-generator implementation " +
            $"(Requirement 16.4). Offenders: {Describe(offenders)}.");
    }

    [Fact]
    public void Api_ContainsNoMatchEntityDefinitions()
    {
        // Requirement 16.4 — match entities are defined in Domain; the Api holds none. Any BaseEntity
        // subclass in the Api assembly is a mis-placed entity definition.
        var offenders = LoadableTypes(ApiAssembly)
            .Where(type => type is { IsClass: true, IsAbstract: false }
                           && typeof(BaseEntity).IsAssignableFrom(type))
            .Select(type => type.FullName!)
            .ToList();

        Assert.True(
            offenders.Count == 0,
            $"{ApiName} must contain no entity definitions (Requirement 16.4). Offenders: {Describe(offenders)}.");
    }

    [Fact]
    public void Api_ContainsNoEfCoreMappings()
    {
        // Requirement 16.4 — EF Core mappings are an Infrastructure concern; the Api declares none.
        var offenders = LoadableTypes(ApiAssembly)
            .Where(type => type is { IsClass: true, IsAbstract: false } && ImplementsEntityConfiguration(type))
            .Select(type => type.FullName!)
            .ToList();

        Assert.True(
            offenders.Count == 0,
            $"{ApiName} must contain no EF Core IEntityTypeConfiguration<> mappings (Requirement 16.4). " +
            $"Offenders: {Describe(offenders)}.");
    }

    [Fact]
    public void Api_ContainsNoMatchUseCaseImplementations()
    {
        // Requirement 16.4 — match use cases (handlers) live in Application; the Api only maps
        // endpoints onto them. No use-case namespace or *Handler type may appear in the Api assembly.
        var offenders = LoadableTypes(ApiAssembly)
            .Where(type => type is { IsClass: true, IsAbstract: false })
            .Where(type =>
                (type.Namespace?.Contains(".Matches.UseCases", StringComparison.Ordinal) ?? false)
                || ((type.Namespace?.StartsWith("PitchMate.Api.Matches", StringComparison.Ordinal) ?? false)
                    && type.Name.EndsWith("Handler", StringComparison.Ordinal)))
            .Select(type => type.FullName!)
            .ToList();

        Assert.True(
            offenders.Count == 0,
            $"{ApiName} must contain no match use-case implementations (Requirement 16.4). " +
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
