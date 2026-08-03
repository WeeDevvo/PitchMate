using System.Reflection;
using Microsoft.EntityFrameworkCore;
using NetArchTest.Rules;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Domain.Common;
using PitchMate.Domain.Matches;
using PitchMate.Infrastructure.Matches;
using PitchMate.Infrastructure.Matches.Repositories;

namespace PitchMate.Infrastructure.Tests.Architecture;

/// <summary>
/// Match-lifecycle-specific Clean Architecture placement tests, extending the general dependency-rule
/// suite in <see cref="ArchitectureDependencyTests"/> with the match subsystem's layering
/// (Requirement 16). These run on every <c>dotnet test</c> so match types cannot drift into the
/// wrong layer unnoticed, keeping the inward-only dependency rule enforceable and failing the build
/// with a message naming the offenders when a reference violates it (Req 16.6).
///
/// What is enforced here (the parts observable without the Api assembly — the Api-holds-only-wiring
/// rule of Req 16.4 and the no-client-references-Domain rule of Req 16.5 are asserted by
/// <c>PitchMate.Api.Tests.Architecture.MatchLayeringAndImplementationLocationTests</c>, which can see
/// the Api assembly):
/// <list type="bullet">
///   <item><description>16.1 — the Match entity, the MatchState enumeration, and the match value
///   objects (KickoffLineup, MatchResult, TeamSheet, …) reside in <c>PitchMate.Domain</c> and depend
///   only on Domain + the BCL (no Application/Infrastructure/Api or EF Core / Npgsql / ASP.NET Core
///   dependency).</description></item>
///   <item><description>16.2 — the <see cref="ITeamBalancer"/> / <see cref="ISillyNameGenerator"/>
///   abstractions, the <see cref="IMatchRepository"/> / <see cref="IAvailabilityRepository"/> /
///   <see cref="IMembershipRatingRepository"/> interfaces, the lifecycle use-case handlers, and the
///   <c>MatchAuthorization</c> gate reside in <c>PitchMate.Application</c> and depend only on Domain
///   (no Infrastructure/Api or EF Core / Npgsql / ASP.NET Core dependency).</description></item>
///   <item><description>16.3 — the <c>TeamBalancer</c>, <c>SillyNameGenerator</c>, the EF Core
///   mappings, and the repository implementations reside in <c>PitchMate.Infrastructure</c> and
///   implement the Application-declared interfaces.</description></item>
/// </list>
///
/// The approach mirrors <see cref="ArchitectureDependencyTests"/> and
/// <see cref="SquadArchitecturePlacementTests"/>: anchor types create a hard compile-time link to
/// each asserted assembly, and match-namespace-scoped <c>NetArchTest.Rules</c> dependency checks
/// catch an actual forbidden type dependency.
/// </summary>
public class MatchArchitecturePlacementTests
{
    private const string DomainName = "PitchMate.Domain";
    private const string ApplicationName = "PitchMate.Application";
    private const string InfrastructureName = "PitchMate.Infrastructure";
    private const string ApiName = "PitchMate.Api";

    private const string MatchDomainNamespace = "PitchMate.Domain.Matches";
    private const string MatchApplicationNamespace = "PitchMate.Application.Matches";

    /// <summary>Full name of the internal match authorization helper, resolved reflectively since it is not public.</summary>
    private const string MatchAuthorizationFullName = "PitchMate.Application.Matches.MatchAuthorization";

    // Anchor types create a hard compile-time and runtime link to each asserted assembly, so a build
    // with a renamed/moved type fails to compile rather than passing these assertions silently.
    private static readonly Assembly DomainAssembly = typeof(Match).Assembly;
    private static readonly Assembly ApplicationAssembly = typeof(ITeamBalancer).Assembly;
    private static readonly Assembly InfrastructureAssembly = typeof(TeamBalancer).Assembly;

    /// <summary>EF Core, Npgsql, and ASP.NET Core namespaces — forbidden in Domain and Application.</summary>
    private static readonly string[] EfNpgsqlAspNetNamespaces =
    {
        "Microsoft.EntityFrameworkCore",
        "Npgsql",
        "Microsoft.AspNetCore",
    };

    /// <summary>The match Domain entities whose placement in <c>PitchMate.Domain</c> is required (Req 16.1).</summary>
    private static readonly Type[] MatchDomainEntities =
    {
        typeof(Match),
        typeof(MatchParticipant),
        typeof(MatchTeam),
        typeof(AvailabilityResponse),
        typeof(MembershipRating),
        typeof(RatingSnapshot),
    };

    /// <summary>The match Domain enumerations, value objects, and error types whose placement in <c>PitchMate.Domain</c> is required (Req 16.1).</summary>
    private static readonly Type[] MatchDomainValueTypes =
    {
        typeof(MatchState),
        typeof(ResultFidelity),
        typeof(KickoffLineup),
        typeof(KickoffTeam),
        typeof(MatchResult),
        typeof(TeamSheet),
        typeof(MatchError),
        typeof(MatchErrorCode),
    };

    /// <summary>The match Application abstractions declared in <c>PitchMate.Application</c> (Req 16.2).</summary>
    private static readonly Type[] MatchApplicationAbstractions =
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
    }

    [Fact]
    public void MatchEntitiesStatesAndValueObjects_ResideInDomainAssembly()
    {
        // Req 16.1 — every match entity, enum, value object, and error type lives in PitchMate.Domain.
        var offenders = MatchDomainEntities
            .Concat(MatchDomainValueTypes)
            .Where(type => type.Assembly.GetName().Name != DomainName)
            .Select(type => $"{type.FullName} in '{type.Assembly.GetName().Name}'")
            .ToList();

        Assert.True(
            offenders.Count == 0,
            $"Every match entity/enum/value-object/error type must reside in {DomainName} " +
            $"(Requirement 16.1). Offenders: {Describe(offenders)}.");
    }

    [Fact]
    public void MatchDomainEntities_DeriveFromBaseEntity()
    {
        // Req 16.1 — the keyed match records carry the BaseEntity GUID v7 key + audit + soft-delete
        // surface; value objects (KickoffLineup, MatchResult, TeamSheet, …) are owned values, not keyed.
        var offenders = MatchDomainEntities
            .Where(type => !typeof(BaseEntity).IsAssignableFrom(type))
            .Select(type => type.FullName!)
            .ToList();

        Assert.True(
            offenders.Count == 0,
            $"Match, MatchParticipant, MatchTeam, AvailabilityResponse, MembershipRating, and " +
            $"RatingSnapshot must derive from {nameof(BaseEntity)} (Requirement 16.1). " +
            $"Offenders: {Describe(offenders)}.");
    }

    [Fact]
    public void MatchDomainNamespace_HasNoDependencyOnOuterLayers()
    {
        // Req 16.1 — the match Domain namespace references no outer PitchMate layer.
        AssertNamespaceHasNoDependencyOn(
            DomainAssembly, MatchDomainNamespace,
            "Requirement 16.1",
            ApplicationName, InfrastructureName, ApiName);
    }

    [Fact]
    public void MatchDomainNamespace_HasNoEfNpgsqlOrAspNetDependency()
    {
        // Req 16.1 — the match Domain namespace stays free of persistence/web frameworks.
        AssertNamespaceHasNoDependencyOn(
            DomainAssembly, MatchDomainNamespace,
            "Requirement 16.1",
            EfNpgsqlAspNetNamespaces);
    }

    [Fact]
    public void MatchUseCasesInterfacesAndAuthorization_ResideInApplicationAssembly()
    {
        // Req 16.2 — match use-case handlers, the balancer/name-generator abstractions, the
        // repository interfaces, and MatchAuthorization live in PitchMate.Application.
        var useCaseHandlers = ApplicationAssembly.GetTypes()
            .Where(type => type is { IsClass: true, IsAbstract: false }
                           && type.Namespace == $"{MatchApplicationNamespace}.UseCases"
                           && type.Name.EndsWith("Handler", StringComparison.Ordinal))
            .ToList();

        Assert.True(
            useCaseHandlers.Count > 0,
            $"Expected match use-case handlers in {MatchApplicationNamespace}.UseCases (Requirement 16.2).");

        // MatchAuthorization is internal to Application, so resolve it reflectively rather than by a
        // direct type reference; its presence in the Application assembly is itself part of the rule.
        var matchAuthorization = ApplicationAssembly.GetType(MatchAuthorizationFullName);
        Assert.True(
            matchAuthorization is not null,
            $"{MatchAuthorizationFullName} must exist in {ApplicationName} (Requirement 16.2).");

        var required = MatchApplicationAbstractions
            .Append(matchAuthorization!)
            .Concat(useCaseHandlers)
            .ToList();

        var offenders = required
            .Where(type => type.Assembly.GetName().Name != ApplicationName)
            .Select(type => $"{type.FullName} in '{type.Assembly.GetName().Name}'")
            .ToList();

        Assert.True(
            offenders.Count == 0,
            $"Match use cases, interfaces, and MatchAuthorization must reside in {ApplicationName} " +
            $"(Requirement 16.2). Offenders: {Describe(offenders)}.");
    }

    [Fact]
    public void MatchApplicationNamespace_DoesNotReferenceInfrastructureOrApi()
    {
        // Req 16.2 — the match Application namespace depends only on Domain (never on the outer layers).
        AssertNamespaceHasNoDependencyOn(
            ApplicationAssembly, MatchApplicationNamespace,
            "Requirement 16.2",
            InfrastructureName, ApiName);
    }

    [Fact]
    public void MatchApplicationNamespace_HasNoEfNpgsqlOrAspNetDependency()
    {
        // Req 16.2 — match use cases stay framework-free (no EF Core / Npgsql / ASP.NET Core types).
        AssertNamespaceHasNoDependencyOn(
            ApplicationAssembly, MatchApplicationNamespace,
            "Requirement 16.2",
            EfNpgsqlAspNetNamespaces);
    }

    [Fact]
    public void MatchApplicationAbstractions_AreImplementedInInfrastructure()
    {
        // Req 16.3 — every match repository interface, the team balancer, and the silly-name generator
        // have a concrete implementation in Infrastructure.
        var missing = MatchApplicationAbstractions
            .Where(abstraction => !ConcreteImplementationsIn(InfrastructureAssembly, abstraction).Any())
            .Select(abstraction => abstraction.Name)
            .ToList();

        Assert.True(
            missing.Count == 0,
            $"{InfrastructureName} must contain a concrete implementation of each match abstraction " +
            $"(Requirement 16.3). Missing: {Describe(missing)}.");
    }

    [Fact]
    public void MatchBalancerEfMappingsAndRepositories_ResideInInfrastructureAssembly()
    {
        // Req 16.3 — the TeamBalancer, SillyNameGenerator, the EF Core mappings, and the repository
        // implementations are Infrastructure concerns.
        var matchEfConfigurations = InfrastructureAssembly.GetTypes()
            .Where(type => type is { IsClass: true, IsAbstract: false }
                           && ImplementsMatchEntityConfiguration(type))
            .ToList();

        Assert.True(
            matchEfConfigurations.Count > 0,
            $"Expected match EF Core IEntityTypeConfiguration<> mappings in {InfrastructureName} (Requirement 16.3).");

        var implementations = new[]
        {
            typeof(TeamBalancer),
            typeof(SillyNameGenerator),
            typeof(EfMatchRepository),
            typeof(EfAvailabilityRepository),
            typeof(EfMembershipRatingRepository),
        };

        var required = matchEfConfigurations
            .Concat(implementations)
            .ToList();

        var offenders = required
            .Where(type => type.Assembly.GetName().Name != InfrastructureName)
            .Select(type => $"{type.FullName} in '{type.Assembly.GetName().Name}'")
            .ToList();

        Assert.True(
            offenders.Count == 0,
            $"Match TeamBalancer, SillyNameGenerator, EF mappings, and repositories must reside in " +
            $"{InfrastructureName} (Requirement 16.3). Offenders: {Describe(offenders)}.");
    }

    private static void AssertNamespaceHasNoDependencyOn(
        Assembly assembly, string ownNamespace, string requirementRef, params string[] forbiddenNamespaces)
    {
        var result = Types.InAssembly(assembly)
            .That().ResideInNamespaceStartingWith(ownNamespace)
            .Should().NotHaveDependencyOnAny(forbiddenNamespaces)
            .GetResult();

        var offenders = result.IsSuccessful
            ? Array.Empty<string>()
            : (result.FailingTypeNames?.ToArray() ?? Array.Empty<string>());

        Assert.True(
            result.IsSuccessful,
            $"Types in {ownNamespace} must not depend on [{string.Join(", ", forbiddenNamespaces)}] " +
            $"({requirementRef}). Offending types: {Describe(offenders)}.");
    }

    private static bool ImplementsMatchEntityConfiguration(Type type) =>
        type.GetInterfaces().Any(i =>
            i.IsGenericType
            && i.GetGenericTypeDefinition() == typeof(IEntityTypeConfiguration<>)
            && i.GetGenericArguments()[0].Namespace == MatchDomainNamespace);

    private static IEnumerable<Type> ConcreteImplementationsIn(Assembly assembly, Type abstraction) =>
        assembly.GetTypes()
            .Where(type => type is { IsClass: true, IsAbstract: false } && abstraction.IsAssignableFrom(type));

    private static string Describe(IReadOnlyCollection<string> offenders) =>
        offenders.Count == 0 ? "(none)" : string.Join("; ", offenders);
}
