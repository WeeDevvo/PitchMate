using System.Reflection;
using Microsoft.EntityFrameworkCore;
using NetArchTest.Rules;
using PitchMate.Application.LiveTracking;
using PitchMate.Application.LiveTracking.UseCases;
using PitchMate.Application.Stats;
using PitchMate.Domain.Common;
using PitchMate.Domain.LiveTracking;
using PitchMate.Infrastructure.LiveTracking;

namespace PitchMate.Infrastructure.Tests.Architecture;

/// <summary>
/// Live-tracking-specific Clean Architecture placement tests, extending the general dependency-rule
/// suite in <see cref="ArchitectureDependencyTests"/> with the live-tracking subsystem's layering
/// (Requirement 14). These run on every <c>dotnet test</c> so live-tracking types cannot drift into
/// the wrong layer unnoticed, keeping the inward-only dependency rule enforceable and failing the
/// build with a message naming the offenders when a reference violates it (Req 14.6). Every check
/// reports all of its offenders together rather than stopping at the first one.
///
/// What is enforced here (the parts observable without the Api assembly — the Api-holds-only-wiring
/// rule of Req 14.4 and the no-client-references-Domain rule of Req 14.5 are asserted by
/// <c>PitchMate.Api.Tests.Architecture.LiveTrackingLayeringAndImplementationLocationTests</c>, which
/// can see the Api assembly):
/// <list type="bullet">
///   <item><description>14.1 — the <see cref="MatchEvent"/> entity hierarchy, the <see cref="EventKind"/>
///   enumeration, and the derivation value objects (<see cref="RunningScore"/>, <see cref="KeeperStint"/>,
///   <see cref="MatchRichStatistics"/>, <see cref="MatchMinute"/>), the <see cref="MatchEventLog"/>
///   projection, and the result triad reside in <c>PitchMate.Domain</c> and depend only on Domain + the
///   BCL (no Application/Infrastructure/Api or EF Core / Npgsql / ASP.NET Core dependency).</description></item>
///   <item><description>14.2 — the recording/finalising/query use-case handlers, the
///   <see cref="IMatchEventRepository"/> abstraction, and the <c>LiveTrackingAuthorization</c> gate
///   reside in <c>PitchMate.Application</c> and depend only on Domain (no Infrastructure/Api or EF Core
///   / Npgsql / ASP.NET Core dependency).</description></item>
///   <item><description>14.3 — the EF Core mappings, <see cref="EfMatchEventRepository"/>, and
///   <see cref="EventLogRichStatsSource"/> reside in <c>PitchMate.Infrastructure</c> and implement the
///   Application-declared interfaces (including the stats-and-summaries <see cref="IRichStatsSource"/>
///   seam), and no such implementation lives in Domain or Application.</description></item>
/// </list>
///
/// The approach mirrors <see cref="ArchitectureDependencyTests"/>, <see cref="MatchArchitecturePlacementTests"/>,
/// and <see cref="StatsArchitecturePlacementTests"/>: anchor types create a hard compile-time link to
/// each asserted assembly, and live-tracking-namespace-scoped <c>NetArchTest.Rules</c> dependency
/// checks catch an actual forbidden type dependency.
/// </summary>
public class LiveTrackingArchitecturePlacementTests
{
    private const string DomainName = "PitchMate.Domain";
    private const string ApplicationName = "PitchMate.Application";
    private const string InfrastructureName = "PitchMate.Infrastructure";
    private const string ApiName = "PitchMate.Api";

    private const string LiveTrackingDomainNamespace = "PitchMate.Domain.LiveTracking";
    private const string LiveTrackingApplicationNamespace = "PitchMate.Application.LiveTracking";

    /// <summary>Full name of the internal live-tracking authorization helper, resolved reflectively since it is not public.</summary>
    private const string LiveTrackingAuthorizationFullName = "PitchMate.Application.LiveTracking.LiveTrackingAuthorization";

    // Anchor types create a hard compile-time and runtime link to each asserted assembly, so a build
    // with a renamed/moved type fails to compile rather than passing these assertions silently.
    private static readonly Assembly DomainAssembly = typeof(MatchEvent).Assembly;
    private static readonly Assembly ApplicationAssembly = typeof(IMatchEventRepository).Assembly;
    private static readonly Assembly InfrastructureAssembly = typeof(EfMatchEventRepository).Assembly;

    /// <summary>EF Core, Npgsql, and ASP.NET Core namespaces — forbidden in Domain and Application.</summary>
    private static readonly string[] EfNpgsqlAspNetNamespaces =
    {
        "Microsoft.EntityFrameworkCore",
        "Npgsql",
        "Microsoft.AspNetCore",
    };

    /// <summary>The live-tracking Domain entity hierarchy whose placement in <c>PitchMate.Domain</c> is required (Req 14.1).</summary>
    private static readonly Type[] LiveTrackingDomainEntities =
    {
        typeof(MatchEvent),
        typeof(GoalScoredEvent),
        typeof(GoalRetractedEvent),
        typeof(KeeperStintStartedEvent),
        typeof(KeeperStintRetractedEvent),
    };

    /// <summary>The concrete, keyed live-tracking events that must derive from <see cref="BaseEntity"/> (Req 14.1, 1.6).</summary>
    private static readonly Type[] LiveTrackingConcreteEvents =
    {
        typeof(GoalScoredEvent),
        typeof(GoalRetractedEvent),
        typeof(KeeperStintStartedEvent),
        typeof(KeeperStintRetractedEvent),
    };

    /// <summary>The live-tracking Domain enumeration, projection, and derivation value objects whose placement in <c>PitchMate.Domain</c> is required (Req 14.1).</summary>
    private static readonly Type[] LiveTrackingDomainValueTypes =
    {
        typeof(EventKind),
        typeof(MatchEventLog),
        typeof(RunningScore),
        typeof(KeeperStint),
        typeof(MatchRichStatistics),
        typeof(MatchMinute),
        typeof(EventIdPolicy),
        typeof(RecordOutcome),
        typeof(BatchResult),
        typeof(LiveTrackingError),
        typeof(LiveTrackingErrorCode),
    };

    /// <summary>The live-tracking abstractions declared in Application and implemented in Infrastructure (Req 14.2, 14.3).</summary>
    private static readonly Type[] LiveTrackingInfrastructureAbstractions =
    {
        typeof(IMatchEventRepository),
        typeof(IRichStatsSource),
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
    public void MatchEventEventKindAndDerivationValueObjects_ResideInDomainAssembly()
    {
        // Req 14.1 — the MatchEvent hierarchy, EventKind, the MatchEventLog projection, and every
        // derivation value object / result type live in PitchMate.Domain.
        var offenders = LiveTrackingDomainEntities
            .Concat(LiveTrackingDomainValueTypes)
            .Where(type => type.Assembly.GetName().Name != DomainName)
            .Select(type => $"{type.FullName} in '{type.Assembly.GetName().Name}'")
            .ToList();

        Assert.True(
            offenders.Count == 0,
            $"The MatchEvent hierarchy, EventKind, the MatchEventLog projection, and the derivation " +
            $"value objects must reside in {DomainName} (Requirement 14.1). Offenders: {Describe(offenders)}.");
    }

    [Fact]
    public void LiveTrackingDomainTypes_ResideInLiveTrackingDomainNamespace()
    {
        // Req 14.1 — the live-tracking Domain types are grouped in the PitchMate.Domain.LiveTracking
        // namespace so the subsystem's boundary is explicit.
        var offenders = LiveTrackingDomainEntities
            .Concat(LiveTrackingDomainValueTypes)
            .Where(type => type.Namespace != LiveTrackingDomainNamespace)
            .Select(type => $"{type.FullName} in namespace '{type.Namespace}'")
            .ToList();

        Assert.True(
            offenders.Count == 0,
            $"The live-tracking Domain types must reside in the {LiveTrackingDomainNamespace} namespace " +
            $"(Requirement 14.1). Offenders: {Describe(offenders)}.");
    }

    [Fact]
    public void MatchEventConcreteSubclasses_DeriveFromBaseEntity()
    {
        // Req 14.1, 1.6 — each concrete, keyed MatchEvent carries the BaseEntity GUID v7 key (the
        // client-supplied Event_Id) + audit + soft-delete surface; the derivation value objects
        // (RunningScore, KeeperStint, MatchRichStatistics, MatchMinute) are owned values, not keyed.
        var offenders = LiveTrackingConcreteEvents
            .Where(type => !typeof(BaseEntity).IsAssignableFrom(type))
            .Select(type => type.FullName!)
            .ToList();

        Assert.True(
            offenders.Count == 0,
            $"Every concrete MatchEvent subclass must derive from {nameof(BaseEntity)} " +
            $"(Requirement 14.1). Offenders: {Describe(offenders)}.");
    }

    [Fact]
    public void LiveTrackingDomainNamespace_HasNoDependencyOnOuterLayers()
    {
        // Req 14.1 — the live-tracking Domain namespace references no outer PitchMate layer.
        AssertNamespaceHasNoDependencyOn(
            DomainAssembly, LiveTrackingDomainNamespace,
            "Requirement 14.1",
            ApplicationName, InfrastructureName, ApiName);
    }

    [Fact]
    public void LiveTrackingDomainNamespace_HasNoEfNpgsqlOrAspNetDependency()
    {
        // Req 14.1 — the live-tracking Domain namespace stays free of persistence/web frameworks.
        AssertNamespaceHasNoDependencyOn(
            DomainAssembly, LiveTrackingDomainNamespace,
            "Requirement 14.1",
            EfNpgsqlAspNetNamespaces);
    }

    [Fact]
    public void RecordingQueryUseCasesInterfaceAndAuthorization_ResideInApplicationAssembly()
    {
        // Req 14.2 — the recording/finalising/query use-case handlers, the IMatchEventRepository
        // abstraction, and LiveTrackingAuthorization live in PitchMate.Application.
        var useCaseHandlers = ApplicationAssembly.GetTypes()
            .Where(type => type is { IsClass: true, IsAbstract: false }
                           && type.Namespace == $"{LiveTrackingApplicationNamespace}.UseCases"
                           && type.Name.EndsWith("Handler", StringComparison.Ordinal))
            .ToList();

        Assert.True(
            useCaseHandlers.Count > 0,
            $"Expected live-tracking use-case handlers in {LiveTrackingApplicationNamespace}.UseCases (Requirement 14.2).");

        // LiveTrackingAuthorization is internal to Application, so resolve it reflectively rather than
        // by a direct type reference; its presence in the Application assembly is itself part of the rule.
        var liveTrackingAuthorization = ApplicationAssembly.GetType(LiveTrackingAuthorizationFullName);
        Assert.True(
            liveTrackingAuthorization is not null,
            $"{LiveTrackingAuthorizationFullName} must exist in {ApplicationName} (Requirement 14.2).");

        var required = useCaseHandlers
            .Append(typeof(IMatchEventRepository))
            .Append(liveTrackingAuthorization!)
            .ToList();

        var offenders = required
            .Where(type => type.Assembly.GetName().Name != ApplicationName)
            .Select(type => $"{type.FullName} in '{type.Assembly.GetName().Name}'")
            .ToList();

        Assert.True(
            offenders.Count == 0,
            $"Live-tracking use cases, IMatchEventRepository, and LiveTrackingAuthorization must reside " +
            $"in {ApplicationName} (Requirement 14.2). Offenders: {Describe(offenders)}.");
    }

    [Fact]
    public void LiveTrackingApplicationNamespace_DoesNotReferenceInfrastructureOrApi()
    {
        // Req 14.2 — the live-tracking Application namespace depends only on Domain (and other inner
        // Application areas), never on the outer layers.
        AssertNamespaceHasNoDependencyOn(
            ApplicationAssembly, LiveTrackingApplicationNamespace,
            "Requirement 14.2",
            InfrastructureName, ApiName);
    }

    [Fact]
    public void LiveTrackingApplicationNamespace_HasNoEfNpgsqlOrAspNetDependency()
    {
        // Req 14.2 — live-tracking use cases stay framework-free (no EF Core / Npgsql / ASP.NET Core
        // types), so all persistence is forced down into Infrastructure (Requirement 14.3).
        AssertNamespaceHasNoDependencyOn(
            ApplicationAssembly, LiveTrackingApplicationNamespace,
            "Requirement 14.2",
            EfNpgsqlAspNetNamespaces);
    }

    [Fact]
    public void LiveTrackingAbstractions_AreImplementedInInfrastructure()
    {
        // Req 14.3 — the append-only event repository and the rich-stats seam have a concrete
        // implementation in Infrastructure (the IRichStatsSource seam from stats-and-summaries is
        // satisfied here by EventLogRichStatsSource).
        var missing = LiveTrackingInfrastructureAbstractions
            .Where(abstraction => !ConcreteImplementationsIn(InfrastructureAssembly, abstraction).Any())
            .Select(abstraction => abstraction.Name)
            .ToList();

        Assert.True(
            missing.Count == 0,
            $"{InfrastructureName} must contain a concrete implementation of each live-tracking " +
            $"abstraction (Requirement 14.3). Missing: {Describe(missing)}.");
    }

    [Fact]
    public void EfMappingsRepositoryAndRichStatsSource_ResideInInfrastructureAssembly()
    {
        // Req 14.3 — the table-per-hierarchy MatchEvent mapping, the EfMatchEventRepository, and the
        // EventLogRichStatsSource are Infrastructure concerns.
        var matchEventEfConfigurations = InfrastructureAssembly.GetTypes()
            .Where(type => type is { IsClass: true, IsAbstract: false }
                           && ImplementsMatchEventEntityConfiguration(type))
            .ToList();

        Assert.True(
            matchEventEfConfigurations.Count > 0,
            $"Expected a MatchEvent EF Core IEntityTypeConfiguration<> mapping in {InfrastructureName} (Requirement 14.3).");

        var implementations = new[]
        {
            typeof(EfMatchEventRepository),
            typeof(EventLogRichStatsSource),
        };

        var offenders = matchEventEfConfigurations
            .Concat(implementations)
            .Where(type => type.Assembly.GetName().Name != InfrastructureName)
            .Select(type => $"{type.FullName} in '{type.Assembly.GetName().Name}'")
            .ToList();

        Assert.True(
            offenders.Count == 0,
            $"The MatchEvent EF mapping, EfMatchEventRepository, and EventLogRichStatsSource must reside " +
            $"in {InfrastructureName} (Requirement 14.3). Offenders: {Describe(offenders)}.");
    }

    [Fact]
    public void LiveTrackingPersistence_IsNotPlacedInDomainOrApplication()
    {
        // Req 14.3 — no event-log repository or rich-stats implementation leaks into the inner layers;
        // any IMatchEventRepository or IRichStatsSource implementation compiled into Domain or
        // Application would be a misplacement of Infrastructure concerns.
        var offenders = new[] { DomainAssembly, ApplicationAssembly }
            .SelectMany(assembly => LiveTrackingInfrastructureAbstractions
                .SelectMany(abstraction => ConcreteImplementationsIn(assembly, abstraction)))
            .Select(type => $"{type.FullName} in '{type.Assembly.GetName().Name}'")
            .ToList();

        Assert.True(
            offenders.Count == 0,
            $"No IMatchEventRepository or IRichStatsSource implementation may reside in {DomainName} or " +
            $"{ApplicationName} — persistence belongs to {InfrastructureName} (Requirement 14.3). " +
            $"Offenders: {Describe(offenders)}.");
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

    private static bool ImplementsMatchEventEntityConfiguration(Type type) =>
        type.GetInterfaces().Any(i =>
            i.IsGenericType
            && i.GetGenericTypeDefinition() == typeof(IEntityTypeConfiguration<>)
            && i.GetGenericArguments()[0].Namespace == LiveTrackingDomainNamespace);

    private static IEnumerable<Type> ConcreteImplementationsIn(Assembly assembly, Type abstraction) =>
        assembly.GetTypes()
            .Where(type => type is { IsClass: true, IsAbstract: false } && abstraction.IsAssignableFrom(type));

    private static string Describe(IReadOnlyCollection<string> offenders) =>
        offenders.Count == 0 ? "(none)" : string.Join("; ", offenders);
}
