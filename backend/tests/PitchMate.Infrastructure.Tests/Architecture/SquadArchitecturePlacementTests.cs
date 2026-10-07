using System.Reflection;
using Microsoft.EntityFrameworkCore;
using NetArchTest.Rules;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Application.Squads.UseCases;
using PitchMate.Domain.Common;
using PitchMate.Domain.Squads;
using PitchMate.Infrastructure.Squads;
using PitchMate.Infrastructure.Squads.Repositories;
using PitchMate.Infrastructure.Stats;

namespace PitchMate.Infrastructure.Tests.Architecture;

/// <summary>
/// Squad-specific Clean Architecture placement tests, extending the general dependency-rule suite
/// in <see cref="ArchitectureDependencyTests"/> with the squad model's layering (Requirement 19).
/// These run on every <c>dotnet test</c> so squad types cannot drift into the wrong layer unnoticed,
/// keeping the inward-only dependency rule enforceable (Req 19.6).
///
/// What is enforced here (the parts observable without the Api assembly — the Api-holds-only-wiring
/// rule of Req 19.4 is asserted by
/// <c>PitchMate.Api.Tests.Architecture.SquadLayeringAndImplementationLocationTests</c>, which can see
/// the Api assembly):
/// <list type="bullet">
///   <item><description>1.7 / 2.7 / 19.1 — the squad entities and enumerations reside in
///   <c>PitchMate.Domain</c> and depend only on Domain + BCL (no Application/Infrastructure/Api or
///   EF Core / Npgsql / ASP.NET Core dependency).</description></item>
///   <item><description>19.2 — the squad use-case handlers, repository/lookup interfaces,
///   <see cref="IInviteSecretService"/>, <see cref="IMembershipHistoryProbe"/>, and
///   <see cref="SquadAuthorization"/> reside in <c>PitchMate.Application</c> and depend only on
///   Domain (no Infrastructure/Api or EF Core / Npgsql / ASP.NET Core dependency).</description></item>
///   <item><description>10.7 / 19.3 — the EF Core mappings, repository implementations,
///   <c>InviteSecretService</c>, and <c>NoMatchHistoryProbe</c> reside in
///   <c>PitchMate.Infrastructure</c> and implement the Application-declared interfaces.</description></item>
///   <item><description>api-response-contracts 11.3 / 11.4 — <see cref="IMembershipStandingSource"/>
///   and <see cref="MembershipStanding"/> are declared in the squad Application namespace, with their
///   squad-read consumer, so the squad read path takes no dependency on the stats use-case
///   namespace.</description></item>
///   <item><description>api-response-contracts 11.5 / 11.6 — <c>EfMembershipStandingSource</c> resides
///   in <c>PitchMate.Infrastructure</c> alongside the existing squad-scoped aggregation
///   (<c>EfStatsRepository</c>), so all squad-scoped aggregation SQL stays in one place, and it takes
///   no dependency on the Domain rating-classification surface — classifying a σ is
///   <c>IRatingEngine.GetState</c>'s job, not the standing source's.</description></item>
/// </list>
///
/// The approach mirrors <see cref="ArchitectureDependencyTests"/>: anchor types create a hard
/// compile-time link to each asserted assembly, and squad-namespace-scoped
/// <c>NetArchTest.Rules</c> dependency checks catch an actual forbidden type dependency.
/// </summary>
public class SquadArchitecturePlacementTests
{
    private const string DomainName = "PitchMate.Domain";
    private const string ApplicationName = "PitchMate.Application";
    private const string InfrastructureName = "PitchMate.Infrastructure";
    private const string ApiName = "PitchMate.Api";

    private const string SquadDomainNamespace = "PitchMate.Domain.Squads";
    private const string SquadApplicationNamespace = "PitchMate.Application.Squads";

    /// <summary>Where the standing abstraction is declared — with its squad-read consumer, not in the stats namespace.</summary>
    private const string StandingAbstractionNamespace = "PitchMate.Application.Squads.Abstractions";

    /// <summary>The stats use-case namespace the squad read path must stay independent of (api-response-contracts 11.4).</summary>
    private const string StatsApplicationNamespace = "PitchMate.Application.Stats";

    /// <summary>The Domain rating namespace holding the classification surface the standing source must not touch (api-response-contracts 11.6).</summary>
    private const string RatingDomainNamespace = "PitchMate.Domain.Rating";

    /// <summary>Full name of the internal squad authorization helper, resolved reflectively since it is not public.</summary>
    private const string SquadAuthorizationFullName = "PitchMate.Application.Squads.SquadAuthorization";

    // Anchor types create a hard compile-time and runtime link to each asserted assembly, so a build
    // with a renamed/moved type fails to compile rather than passing these assertions silently.
    private static readonly Assembly DomainAssembly = typeof(Squad).Assembly;
    private static readonly Assembly ApplicationAssembly = typeof(ISquadRepository).Assembly;
    private static readonly Assembly InfrastructureAssembly = typeof(InviteSecretService).Assembly;

    /// <summary>EF Core, Npgsql, and ASP.NET Core namespaces — forbidden in Domain and Application.</summary>
    private static readonly string[] EfNpgsqlAspNetNamespaces =
    {
        "Microsoft.EntityFrameworkCore",
        "Npgsql",
        "Microsoft.AspNetCore",
    };

    /// <summary>The squad Domain entities whose placement in <c>PitchMate.Domain</c> is required (Req 1.7, 2.7, 19.1).</summary>
    private static readonly Type[] SquadDomainEntities =
    {
        typeof(Squad),
        typeof(SquadMembership),
        typeof(Invite),
        typeof(GuestClaim),
        typeof(SquadFeatureFlag),
    };

    /// <summary>The squad Domain enumerations and error types whose placement in <c>PitchMate.Domain</c> is required (Req 1.7, 2.7, 19.1).</summary>
    private static readonly Type[] SquadDomainValueTypes =
    {
        typeof(SquadRole),
        typeof(MembershipState),
        typeof(InviteState),
        typeof(SquadFeature),
        typeof(GuestClaimState),
        typeof(SquadError),
        typeof(SquadErrorCode),
    };

    /// <summary>
    /// The squad Application abstractions declared in <c>PitchMate.Application</c> (Req 19.2), now
    /// including the member-standing source the squad read decorates its member views from
    /// (api-response-contracts 11.3).
    /// </summary>
    private static readonly Type[] SquadApplicationAbstractions =
    {
        typeof(ISquadRepository),
        typeof(ISquadMembershipRepository),
        typeof(IInviteRepository),
        typeof(IGuestClaimRepository),
        typeof(IInviteSecretService),
        typeof(IMembershipHistoryProbe),
        typeof(IMembershipStandingSource),
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
    public void SquadEntitiesAndEnums_ResideInDomainAssembly()
    {
        // Req 1.7, 2.7, 19.1 — every squad entity, enum, and error type lives in PitchMate.Domain.
        var offenders = SquadDomainEntities
            .Concat(SquadDomainValueTypes)
            .Where(type => type.Assembly.GetName().Name != DomainName)
            .Select(type => $"{type.FullName} in '{type.Assembly.GetName().Name}'")
            .ToList();

        Assert.True(
            offenders.Count == 0,
            $"Every squad entity/enum/error type must reside in {DomainName} " +
            $"(Requirements 1.7, 2.7, 19.1). Offenders: {Describe(offenders)}.");
    }

    [Fact]
    public void SquadDomainEntities_DeriveFromBaseEntity()
    {
        // Req 19.5 (placement half) / 19.1 — squad records carry the BaseEntity GUID v7 key + audit +
        // soft-delete surface; SquadFeatureFlag is an owned value on the Squad, not a keyed entity.
        var offenders = new[] { typeof(Squad), typeof(SquadMembership), typeof(Invite), typeof(GuestClaim) }
            .Where(type => !typeof(BaseEntity).IsAssignableFrom(type))
            .Select(type => type.FullName!)
            .ToList();

        Assert.True(
            offenders.Count == 0,
            $"Squad, SquadMembership, Invite, and GuestClaim must derive from {nameof(BaseEntity)} " +
            $"(Requirement 19.1, 19.5). Offenders: {Describe(offenders)}.");
    }

    [Fact]
    public void SquadDomainNamespace_HasNoDependencyOnOuterLayers()
    {
        // Req 1.7, 2.7, 19.1 — the squad Domain namespace references no outer PitchMate layer.
        AssertNamespaceHasNoDependencyOn(
            DomainAssembly, SquadDomainNamespace,
            "Requirements 1.7, 2.7, 19.1",
            ApplicationName, InfrastructureName, ApiName);
    }

    [Fact]
    public void SquadDomainNamespace_HasNoEfNpgsqlOrAspNetDependency()
    {
        // Req 1.7, 2.7, 19.1 — the squad Domain namespace stays free of persistence/web frameworks.
        AssertNamespaceHasNoDependencyOn(
            DomainAssembly, SquadDomainNamespace,
            "Requirements 1.7, 2.7, 19.1",
            EfNpgsqlAspNetNamespaces);
    }

    [Fact]
    public void SquadUseCasesInterfacesAndAuthorization_ResideInApplicationAssembly()
    {
        // Req 19.2 — squad use-case handlers, repository/lookup interfaces, IInviteSecretService,
        // IMembershipHistoryProbe, and SquadAuthorization live in PitchMate.Application.
        var useCaseHandlers = ApplicationAssembly.GetTypes()
            .Where(type => type is { IsClass: true, IsAbstract: false }
                           && type.Namespace == $"{SquadApplicationNamespace}.UseCases"
                           && type.Name.EndsWith("Handler", StringComparison.Ordinal))
            .ToList();

        Assert.True(
            useCaseHandlers.Count > 0,
            $"Expected squad use-case handlers in {SquadApplicationNamespace}.UseCases (Requirement 19.2).");

        // SquadAuthorization is internal to Application, so resolve it reflectively rather than by a
        // direct type reference; its presence in the Application assembly is itself part of the rule.
        var squadAuthorization = ApplicationAssembly.GetType(SquadAuthorizationFullName);
        Assert.True(
            squadAuthorization is not null,
            $"{SquadAuthorizationFullName} must exist in {ApplicationName} (Requirement 19.2).");

        var required = SquadApplicationAbstractions
            .Append(squadAuthorization!)
            .Concat(useCaseHandlers)
            .ToList();

        var offenders = required
            .Where(type => type.Assembly.GetName().Name != ApplicationName)
            .Select(type => $"{type.FullName} in '{type.Assembly.GetName().Name}'")
            .ToList();

        Assert.True(
            offenders.Count == 0,
            $"Squad use cases, interfaces, and SquadAuthorization must reside in {ApplicationName} " +
            $"(Requirement 19.2). Offenders: {Describe(offenders)}.");
    }

    [Fact]
    public void SquadApplicationNamespace_DoesNotReferenceInfrastructureOrApi()
    {
        // Req 19.2 — the squad Application namespace depends only on Domain (never on the outer layers).
        AssertNamespaceHasNoDependencyOn(
            ApplicationAssembly, SquadApplicationNamespace,
            "Requirement 19.2",
            InfrastructureName, ApiName);
    }

    [Fact]
    public void SquadApplicationNamespace_HasNoEfNpgsqlOrAspNetDependency()
    {
        // Req 19.2 — squad use cases stay framework-free (no EF Core / Npgsql / ASP.NET Core types).
        AssertNamespaceHasNoDependencyOn(
            ApplicationAssembly, SquadApplicationNamespace,
            "Requirement 19.2",
            EfNpgsqlAspNetNamespaces);
    }

    [Fact]
    public void SquadApplicationAbstractions_AreImplementedInInfrastructure()
    {
        // Req 10.7, 19.3 — every squad repository/lookup interface, the invite secret service, and the
        // membership-history probe have a concrete implementation in Infrastructure.
        var missing = SquadApplicationAbstractions
            .Where(abstraction => !ConcreteImplementationsIn(InfrastructureAssembly, abstraction).Any())
            .Select(abstraction => abstraction.Name)
            .ToList();

        Assert.True(
            missing.Count == 0,
            $"{InfrastructureName} must contain a concrete implementation of each squad abstraction " +
            $"(Requirements 10.7, 19.3). Missing: {Describe(missing)}.");
    }

    [Fact]
    public void SquadEfMappingsRepositoriesAndSecretService_ResideInInfrastructureAssembly()
    {
        // Req 10.7, 19.3 — the EF Core mappings, repository implementations, InviteSecretService, and
        // NoMatchHistoryProbe are Infrastructure concerns.
        var squadEfConfigurations = InfrastructureAssembly.GetTypes()
            .Where(type => type is { IsClass: true, IsAbstract: false }
                           && ImplementsSquadEntityConfiguration(type))
            .ToList();

        Assert.True(
            squadEfConfigurations.Count > 0,
            $"Expected squad EF Core IEntityTypeConfiguration<> mappings in {InfrastructureName} (Requirement 19.3).");

        var repositoryImplementations = new[]
        {
            typeof(EfSquadRepository),
            typeof(EfSquadMembershipRepository),
            typeof(EfInviteRepository),
            typeof(EfGuestClaimRepository),
        };

        var required = squadEfConfigurations
            .Concat(repositoryImplementations)
            .Append(typeof(InviteSecretService))
            .Append(typeof(NoMatchHistoryProbe))
            .ToList();

        var offenders = required
            .Where(type => type.Assembly.GetName().Name != InfrastructureName)
            .Select(type => $"{type.FullName} in '{type.Assembly.GetName().Name}'")
            .ToList();

        Assert.True(
            offenders.Count == 0,
            $"Squad EF mappings, repositories, InviteSecretService, and NoMatchHistoryProbe must " +
            $"reside in {InfrastructureName} (Requirements 10.7, 19.3). Offenders: {Describe(offenders)}.");
    }

    [Fact]
    public void MembershipStandingAbstraction_IsDeclaredWithItsSquadApplicationConsumer()
    {
        // api-response-contracts 11.3, 11.4 — the standing source and the standing value it reports are
        // declared in the squad Application namespace, beside the squad read that consumes them, rather
        // than in the stats use-case namespace.
        var offenders = new[] { typeof(IMembershipStandingSource), typeof(MembershipStanding) }
            .Where(type => type.Assembly.GetName().Name != ApplicationName
                           || type.Namespace != StandingAbstractionNamespace)
            .Select(type => $"{type.FullName} in '{type.Assembly.GetName().Name}' namespace '{type.Namespace}'")
            .ToList();

        Assert.True(
            offenders.Count == 0,
            $"{nameof(IMembershipStandingSource)} and {nameof(MembershipStanding)} must be declared in " +
            $"{StandingAbstractionNamespace} (api-response-contracts 11.3, 11.4). Offenders: {Describe(offenders)}.");
    }

    [Fact]
    public void SquadApplicationNamespace_DoesNotDependOnTheStatsUseCaseNamespace()
    {
        // api-response-contracts 11.4 — placing the standing abstraction with its consumer keeps the
        // squad read path free of any dependency on the stats use-case namespace.
        AssertNamespaceHasNoDependencyOn(
            ApplicationAssembly, SquadApplicationNamespace,
            "api-response-contracts 11.4",
            StatsApplicationNamespace);
    }

    [Fact]
    public void MembershipStandingSource_IsImplementedInInfrastructureAlongsideTheSquadScopedAggregation()
    {
        // api-response-contracts 11.5 — the standing aggregation SQL is an Infrastructure concern and
        // sits in the same namespace as the existing squad-scoped aggregation (EfStatsRepository), so
        // every squad-scoped aggregation query stays in one place.
        var offenders = new List<string>();

        if (typeof(EfMembershipStandingSource).Assembly.GetName().Name != InfrastructureName)
        {
            offenders.Add(
                $"{typeof(EfMembershipStandingSource).FullName} in " +
                $"'{typeof(EfMembershipStandingSource).Assembly.GetName().Name}'");
        }

        if (typeof(EfMembershipStandingSource).Namespace != typeof(EfStatsRepository).Namespace)
        {
            offenders.Add(
                $"{typeof(EfMembershipStandingSource).FullName} is in namespace " +
                $"'{typeof(EfMembershipStandingSource).Namespace}', not beside " +
                $"{typeof(EfStatsRepository).FullName}");
        }

        Assert.True(
            offenders.Count == 0,
            $"EfMembershipStandingSource must reside in {InfrastructureName} alongside the existing " +
            $"squad-scoped aggregation (api-response-contracts 11.5). Offenders: {Describe(offenders)}.");

        // The negative half: no standing-source implementation compiled into the inner layers.
        var misplaced = new[] { DomainAssembly, ApplicationAssembly }
            .SelectMany(assembly => ConcreteImplementationsIn(assembly, typeof(IMembershipStandingSource)))
            .Select(type => $"{type.FullName} in '{type.Assembly.GetName().Name}'")
            .ToList();

        Assert.True(
            misplaced.Count == 0,
            $"No {nameof(IMembershipStandingSource)} implementation may reside in {DomainName} or " +
            $"{ApplicationName} — aggregation SQL belongs to {InfrastructureName} " +
            $"(api-response-contracts 11.5). Offenders: {Describe(misplaced)}.");
    }

    [Fact]
    public void MembershipStandingSource_TakesNoDependencyOnTheRatingClassificationSurface()
    {
        // api-response-contracts 11.6 — the standing source reports raw standing only. Classifying a σ
        // as provisional or established is the Domain rule (IRatingEngine.GetState), applied by the
        // consuming handler, so the implementation references no type from the Domain rating namespace.
        var result = Types.InAssembly(InfrastructureAssembly)
            .That().HaveName(nameof(EfMembershipStandingSource))
            .Should().NotHaveDependencyOn(RatingDomainNamespace)
            .GetResult();

        var offenders = result.IsSuccessful
            ? Array.Empty<string>()
            : (result.FailingTypeNames?.ToArray() ?? Array.Empty<string>());

        Assert.True(
            result.IsSuccessful,
            $"{nameof(EfMembershipStandingSource)} must not depend on {RatingDomainNamespace} — the " +
            $"provisional classification stays in {DomainName} (api-response-contracts 11.6). " +
            $"Offending types: {Describe(offenders)}.");
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

    private static bool ImplementsSquadEntityConfiguration(Type type) =>
        type.GetInterfaces().Any(i =>
            i.IsGenericType
            && i.GetGenericTypeDefinition() == typeof(IEntityTypeConfiguration<>)
            && i.GetGenericArguments()[0].Namespace == SquadDomainNamespace);

    private static IEnumerable<Type> ConcreteImplementationsIn(Assembly assembly, Type abstraction) =>
        assembly.GetTypes()
            .Where(type => type is { IsClass: true, IsAbstract: false } && abstraction.IsAssignableFrom(type));

    private static string Describe(IReadOnlyCollection<string> offenders) =>
        offenders.Count == 0 ? "(none)" : string.Join("; ", offenders);
}
