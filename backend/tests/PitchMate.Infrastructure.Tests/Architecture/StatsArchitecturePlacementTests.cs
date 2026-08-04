using System.Reflection;
using NetArchTest.Rules;
using PitchMate.Application.Stats;
using PitchMate.Domain.Stats;
using PitchMate.Infrastructure.Stats;

namespace PitchMate.Infrastructure.Tests.Architecture;

/// <summary>
/// Stats-and-summaries Clean Architecture placement tests, extending the general dependency-rule
/// suite in <see cref="ArchitectureDependencyTests"/> with the stats subsystem's layering
/// (Requirement 15). These run on every <c>dotnet test</c> so stats types cannot drift into the
/// wrong layer unnoticed, keeping the inward-only dependency rule enforceable and failing the build
/// with a message naming the offenders when a reference violates it (Req 15.7).
///
/// What is enforced here (the parts observable without the Api assembly — the Api-holds-only-wiring
/// rule of Req 15.4 is asserted by
/// <c>PitchMate.Api.Tests.Architecture.StatsLayeringAndImplementationLocationTests</c>, which can see
/// the Api assembly):
/// <list type="bullet">
///   <item><description>15.1 — the pure statistic calculators and read-shaping types (PlayerResult,
///   WinPercentage, StreakCalculator, DisplayRatingCalculator, DisplayRatingParameters,
///   RatingSummary) reside in <c>PitchMate.Domain</c> and depend only on Domain + the BCL (no
///   Application/Infrastructure/Api or EF Core / Npgsql / ASP.NET Core dependency).</description></item>
///   <item><description>15.2 — the stats query use-case handlers, the <see cref="IStatsRepository"/> /
///   <see cref="IDisplayRatingParametersSource"/> / <see cref="IRichStatsSource"/> abstractions, and
///   the <c>StatsAuthorization</c> gate reside in <c>PitchMate.Application</c> and depend only on
///   Domain (no Infrastructure/Api or EF Core / Npgsql / ASP.NET Core dependency).</description></item>
///   <item><description>15.3 — the SQL-aggregation <c>EfStatsRepository</c> and the params/rich
///   sources reside in <c>PitchMate.Infrastructure</c> and implement the Application-declared
///   interfaces; no stats aggregation lives in Domain or Application.</description></item>
///   <item><description>7.6 — the presentational <c>Display_Rating</c> is produced only by the stats
///   read path: no rating-update code (<c>PitchMate.Domain.Rating</c>,
///   <c>PitchMate.Application.Matches</c>) and no team-balancing code
///   (<c>PitchMate.Infrastructure.Matches</c>) references the display-rating types or the stats
///   namespaces.</description></item>
/// </list>
///
/// The approach mirrors <see cref="ArchitectureDependencyTests"/> and
/// <see cref="MatchArchitecturePlacementTests"/>: anchor types create a hard compile-time link to
/// each asserted assembly, and stats-namespace-scoped <c>NetArchTest.Rules</c> dependency checks
/// catch an actual forbidden type dependency.
/// </summary>
public class StatsArchitecturePlacementTests
{
    private const string DomainName = "PitchMate.Domain";
    private const string ApplicationName = "PitchMate.Application";
    private const string InfrastructureName = "PitchMate.Infrastructure";
    private const string ApiName = "PitchMate.Api";

    private const string StatsDomainNamespace = "PitchMate.Domain.Stats";
    private const string StatsApplicationNamespace = "PitchMate.Application.Stats";
    private const string StatsInfrastructureNamespace = "PitchMate.Infrastructure.Stats";

    // Rating-update lives in the rating engine's Domain namespace and the match use cases; team
    // balancing lives in the match use cases (the abstraction) and the Infrastructure balancer.
    private const string RatingDomainNamespace = "PitchMate.Domain.Rating";
    private const string MatchApplicationNamespace = "PitchMate.Application.Matches";
    private const string MatchInfrastructureNamespace = "PitchMate.Infrastructure.Matches";

    /// <summary>Full name of the internal stats authorization helper, resolved reflectively since it is not public.</summary>
    private const string StatsAuthorizationFullName = "PitchMate.Application.Stats.StatsAuthorization";

    // Anchor types create a hard compile-time and runtime link to each asserted assembly, so a build
    // with a renamed/moved type fails to compile rather than passing these assertions silently.
    private static readonly Assembly DomainAssembly = typeof(DisplayRatingCalculator).Assembly;
    private static readonly Assembly ApplicationAssembly = typeof(IStatsRepository).Assembly;
    private static readonly Assembly InfrastructureAssembly = typeof(EfStatsRepository).Assembly;

    /// <summary>EF Core, Npgsql, and ASP.NET Core namespaces — forbidden in Domain and Application.</summary>
    private static readonly string[] EfNpgsqlAspNetNamespaces =
    {
        "Microsoft.EntityFrameworkCore",
        "Npgsql",
        "Microsoft.AspNetCore",
    };

    /// <summary>The pure stats calculators and read-shaping types whose placement in <c>PitchMate.Domain</c> is required (Req 15.1).</summary>
    private static readonly Type[] StatsDomainTypes =
    {
        typeof(PlayerResult),
        typeof(WinPercentage),
        typeof(StreakCalculator),
        typeof(DisplayRatingCalculator),
        typeof(DisplayRatingParameters),
        typeof(RatingSummary),
    };

    /// <summary>The stats Application abstractions declared in <c>PitchMate.Application</c> (Req 15.2).</summary>
    private static readonly Type[] StatsApplicationAbstractions =
    {
        typeof(IStatsRepository),
        typeof(IDisplayRatingParametersSource),
        typeof(IRichStatsSource),
    };

    /// <summary>The display-rating types that must be produced only by the stats read path (Req 7.6).</summary>
    private static readonly Type[] DisplayRatingTypes =
    {
        typeof(DisplayRatingCalculator),
        typeof(DisplayRatingParameters),
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
    public void StatsCalculatorsAndReadShapingTypes_ResideInDomainAssembly()
    {
        // Req 15.1 — every pure stats calculator and read-shaping type lives in PitchMate.Domain.
        var offenders = StatsDomainTypes
            .Where(type => type.Assembly.GetName().Name != DomainName)
            .Select(type => $"{type.FullName} in '{type.Assembly.GetName().Name}'")
            .ToList();

        Assert.True(
            offenders.Count == 0,
            $"Every stats calculator/read-shaping type must reside in {DomainName} " +
            $"(Requirement 15.1). Offenders: {Describe(offenders)}.");
    }

    [Fact]
    public void StatsDomainNamespace_HasNoDependencyOnOuterLayers()
    {
        // Req 15.1 — the stats Domain namespace references no outer PitchMate layer (Domain + BCL only).
        AssertNamespaceHasNoDependencyOn(
            DomainAssembly, StatsDomainNamespace,
            "Requirement 15.1",
            ApplicationName, InfrastructureName, ApiName);
    }

    [Fact]
    public void StatsDomainNamespace_HasNoEfNpgsqlOrAspNetDependency()
    {
        // Req 15.1 — the stats Domain namespace stays free of persistence/web frameworks.
        AssertNamespaceHasNoDependencyOn(
            DomainAssembly, StatsDomainNamespace,
            "Requirement 15.1",
            EfNpgsqlAspNetNamespaces);
    }

    [Fact]
    public void StatsUseCasesInterfacesAndAuthorization_ResideInApplicationAssembly()
    {
        // Req 15.2 — the stats query use-case handlers, the repository/service abstractions, and the
        // StatsAuthorization gate live in PitchMate.Application.
        var useCaseHandlers = ApplicationAssembly.GetTypes()
            .Where(type => type is { IsClass: true, IsAbstract: false }
                           && type.Namespace == StatsApplicationNamespace
                           && type.Name.EndsWith("Handler", StringComparison.Ordinal))
            .ToList();

        Assert.True(
            useCaseHandlers.Count > 0,
            $"Expected stats use-case handlers in {StatsApplicationNamespace} (Requirement 15.2).");

        // StatsAuthorization is internal to Application, so resolve it reflectively rather than by a
        // direct type reference; its presence in the Application assembly is itself part of the rule.
        var statsAuthorization = ApplicationAssembly.GetType(StatsAuthorizationFullName);
        Assert.True(
            statsAuthorization is not null,
            $"{StatsAuthorizationFullName} must exist in {ApplicationName} (Requirement 15.2).");

        var required = StatsApplicationAbstractions
            .Append(statsAuthorization!)
            .Concat(useCaseHandlers)
            .ToList();

        var offenders = required
            .Where(type => type.Assembly.GetName().Name != ApplicationName)
            .Select(type => $"{type.FullName} in '{type.Assembly.GetName().Name}'")
            .ToList();

        Assert.True(
            offenders.Count == 0,
            $"Stats use cases, interfaces, and StatsAuthorization must reside in {ApplicationName} " +
            $"(Requirement 15.2). Offenders: {Describe(offenders)}.");
    }

    [Fact]
    public void StatsApplicationNamespace_DoesNotReferenceInfrastructureOrApi()
    {
        // Req 15.2 — the stats Application namespace depends only on Domain (never on the outer layers).
        AssertNamespaceHasNoDependencyOn(
            ApplicationAssembly, StatsApplicationNamespace,
            "Requirement 15.2",
            InfrastructureName, ApiName);
    }

    [Fact]
    public void StatsApplicationNamespace_HasNoEfNpgsqlOrAspNetDependency()
    {
        // Req 15.2 — stats use cases stay framework-free (no EF Core / Npgsql / ASP.NET Core types),
        // so all SQL aggregation is forced down into Infrastructure (Requirement 15.3).
        AssertNamespaceHasNoDependencyOn(
            ApplicationAssembly, StatsApplicationNamespace,
            "Requirement 15.2",
            EfNpgsqlAspNetNamespaces);
    }

    [Fact]
    public void StatsAbstractions_AreImplementedInInfrastructure()
    {
        // Req 15.3 — the stats repository and the params/rich sources have a concrete implementation
        // in Infrastructure, so the SQL aggregation lives there and nowhere inner.
        var missing = StatsApplicationAbstractions
            .Where(abstraction => !ConcreteImplementationsIn(InfrastructureAssembly, abstraction).Any())
            .Select(abstraction => abstraction.Name)
            .ToList();

        Assert.True(
            missing.Count == 0,
            $"{InfrastructureName} must contain a concrete implementation of each stats abstraction " +
            $"(Requirement 15.3). Missing: {Describe(missing)}.");
    }

    [Fact]
    public void StatsAggregationImplementations_ResideInInfrastructureAssembly()
    {
        // Req 15.3 — the SQL-aggregation repository and the params/rich sources are Infrastructure
        // concerns; the concrete implementations must not live inner.
        var implementations = new[]
        {
            typeof(EfStatsRepository),
            typeof(SquadDisplayRatingParametersSource),
            typeof(EmptyRichStatsSource),
        };

        var offenders = implementations
            .Where(type => type.Assembly.GetName().Name != InfrastructureName)
            .Select(type => $"{type.FullName} in '{type.Assembly.GetName().Name}'")
            .ToList();

        Assert.True(
            offenders.Count == 0,
            $"Stats EfStatsRepository and the params/rich sources must reside in {InfrastructureName} " +
            $"(Requirement 15.3). Offenders: {Describe(offenders)}.");
    }

    [Fact]
    public void StatsSqlAggregation_IsNotPlacedInDomainOrApplication()
    {
        // Req 15.3 — no EF Core statistic-aggregation query mapping leaks into the inner layers; any
        // IStatsRepository implementation compiled into Domain or Application would be a misplacement.
        var offenders = new[] { DomainAssembly, ApplicationAssembly }
            .SelectMany(assembly => ConcreteImplementationsIn(assembly, typeof(IStatsRepository)))
            .Select(type => $"{type.FullName} in '{type.Assembly.GetName().Name}'")
            .ToList();

        Assert.True(
            offenders.Count == 0,
            $"No {nameof(IStatsRepository)} implementation may reside in {DomainName} or " +
            $"{ApplicationName} — SQL aggregation belongs to {InfrastructureName} (Requirement 15.3). " +
            $"Offenders: {Describe(offenders)}.");
    }

    [Fact]
    public void DisplayRatingTypes_ResideInStatsDomainNamespace()
    {
        // Req 7.6 — the display-rating derivation is a stats read-path concern; it lives in the stats
        // Domain namespace and nowhere else.
        var offenders = DisplayRatingTypes
            .Where(type => type.Namespace != StatsDomainNamespace)
            .Select(type => $"{type.FullName} in namespace '{type.Namespace}'")
            .ToList();

        Assert.True(
            offenders.Count == 0,
            $"The display-rating types must reside in {StatsDomainNamespace} (Requirement 7.6). " +
            $"Offenders: {Describe(offenders)}.");
    }

    [Fact]
    public void RatingUpdateCode_DoesNotReferenceStats()
    {
        // Req 7.6 — the rating engine and rating-update types never see the presentational display
        // rating or any other stats type; the display rating is derived downstream on read only.
        AssertNamespaceHasNoDependencyOn(
            DomainAssembly, RatingDomainNamespace,
            "Requirement 7.6",
            StatsDomainNamespace);

        AssertNamespaceHasNoDependencyOn(
            ApplicationAssembly, MatchApplicationNamespace,
            "Requirement 7.6",
            StatsDomainNamespace, StatsApplicationNamespace);
    }

    [Fact]
    public void TeamBalancingCode_DoesNotReferenceStats()
    {
        // Req 7.6 — team balancing uses the underlying μ/σ model, never the presentational display
        // rating; the Infrastructure balancer takes no dependency on the stats types.
        AssertNamespaceHasNoDependencyOn(
            InfrastructureAssembly, MatchInfrastructureNamespace,
            "Requirement 7.6",
            StatsDomainNamespace, StatsApplicationNamespace, StatsInfrastructureNamespace);
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

    private static IEnumerable<Type> ConcreteImplementationsIn(Assembly assembly, Type abstraction) =>
        assembly.GetTypes()
            .Where(type => type is { IsClass: true, IsAbstract: false } && abstraction.IsAssignableFrom(type));

    private static string Describe(IReadOnlyCollection<string> offenders) =>
        offenders.Count == 0 ? "(none)" : string.Join("; ", offenders);
}
