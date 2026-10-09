using System.Reflection;
using Microsoft.EntityFrameworkCore;
using PitchMate.Application.Squads.Abstractions;

namespace PitchMate.Api.Tests.Architecture;

/// <summary>
/// Architecture / dependency-rule tests for the response-contract change (Requirement 11), extending
/// the six per-subsystem reflection suites in this folder
/// (<see cref="AuthLayeringAndImplementationLocationTests"/>,
/// <see cref="SquadLayeringAndImplementationLocationTests"/>,
/// <see cref="StatsLayeringAndImplementationLocationTests"/>,
/// <see cref="NotificationLayeringAndImplementationLocationTests"/>,
/// <see cref="MatchLayeringAndImplementationLocationTests"/> and
/// <see cref="LiveTrackingLayeringAndImplementationLocationTests"/>) rather than replacing them.
/// Those suites each assert their own subsystem's placement; the rules this change needs are
/// assembly-wide and cross-subsystem, so they are stated once here:
/// <list type="bullet">
///   <item><description>11.1 — the Response_Conventions and the Transport_Records added by this
///   change reside in <c>PitchMate.Api</c>.</description></item>
///   <item><description>11.2 — after those additions the <c>PitchMate.Api</c> assembly still contains
///   <em>no</em> use-case handler (any subsystem, not just the six asserted individually), no
///   <see cref="IEntityTypeConfiguration{TEntity}"/>, and no rating or statistics-aggregation
///   type in any member signature.</description></item>
///   <item><description>11.3 / 11.4 — the Account_View, the Get_Account_Use_Case, and the
///   Membership_Standing_Source abstraction are declared in <c>PitchMate.Application</c>, the
///   standing abstraction sitting with its squad-read consumer.</description></item>
///   <item><description>11.5 — the Membership_Standing_Source is implemented in
///   <c>PitchMate.Infrastructure</c> and not in the Api.</description></item>
///   <item><description>11.8 — the change introduces no new package: the Api takes its wire contract
///   from the in-box <c>System.Text.Json</c> converter and its response metadata from the already
///   pinned ASP.NET Core OpenAPI packages, referencing no third-party serialisation, mapping, or
///   schema package.</description></item>
/// </list>
///
/// The approach matches the sibling suites exactly — <see cref="System.Reflection"/> only, no extra
/// test package — with anchor types creating a hard compile-time link to each asserted assembly so a
/// renamed or relocated type fails the build rather than passing these assertions silently.
/// <para>
/// The three Requirement 11.2 assertions below delegate to <see cref="InwardLogicRule"/>, which
/// Property 21 (<see cref="ApiInwardLogicProperties"/>) also calls — once against this same assembly
/// and once against types planted to break it. One predicate, two callers: this suite says the Api is
/// clean, and the property says the rule that judged it has teeth.
/// </para>
/// <para>
/// Requirement 11.6 (no σ-threshold comparison outside the Domain-declared rule) is a source-level
/// rule, stated as <see cref="InwardLogicSourceScan"/> and asserted by
/// <see cref="ProvisionalClassificationSourceScanTests"/>.
/// </para>
/// </summary>
public class ResponseContractLayeringTests
{
    private const string DomainName = "PitchMate.Domain";
    private const string ApplicationName = "PitchMate.Application";
    private const string InfrastructureName = "PitchMate.Infrastructure";
    private const string ApiName = "PitchMate.Api";

    private const string StandingAbstractionNamespace = "PitchMate.Application.Squads.Abstractions";

    // Anchor types create a hard compile-time and runtime link to each asserted assembly, so a build
    // with a renamed/missing assembly fails to compile rather than passing this suite silently.
    private static readonly Assembly DomainAssembly = typeof(PitchMate.Domain.Rating.IRatingEngine).Assembly;
    private static readonly Assembly ApplicationAssembly = typeof(IMembershipStandingSource).Assembly;
    private static readonly Assembly InfrastructureAssembly = typeof(PitchMate.Infrastructure.Stats.EmptyRichStatsSource).Assembly;
    private static readonly Assembly ApiAssembly = typeof(Program).Assembly;

    /// <summary>
    /// The six response-convention classes added beside the error seams by this change. They are
    /// transport metadata and belong in the Api (Requirement 11.1); they are <c>internal</c>, which
    /// the existing <c>InternalsVisibleTo</c> for this test project makes visible.
    /// </summary>
    private static readonly Type[] ResponseConventions =
    {
        typeof(PitchMate.Api.Auth.Endpoints.AuthResponseConventions),
        typeof(PitchMate.Api.Squads.Endpoints.SquadResponseConventions),
        typeof(PitchMate.Api.Stats.Endpoints.StatsResponseConventions),
        typeof(PitchMate.Api.Notifications.Endpoints.NotificationResponseConventions),
        typeof(PitchMate.Api.Matches.Endpoints.MatchResponseConventions),
        typeof(PitchMate.Api.LiveTracking.Endpoints.LiveTrackingResponseConventions),
    };

    /// <summary>
    /// The three named transport records added by this change, each existing only because the wire
    /// shape differs from the value the use case returns (Requirement 11.1).
    /// </summary>
    private static readonly Type[] TransportRecords =
    {
        typeof(PitchMate.Api.HealthResponse),
        typeof(PitchMate.Api.Notifications.Endpoints.UnreadCountResponse),
        typeof(PitchMate.Api.Notifications.Endpoints.MarkAllReadResponse),
    };

    /// <summary>
    /// Assembly-name fragments of the third-party serialisation / mapping / schema packages this
    /// change would have had to add had it not used what is already pinned (Requirement 11.8). The
    /// wire contract comes from the in-box <c>System.Text.Json</c> converter and the response
    /// metadata from <c>Microsoft.AspNetCore.OpenApi</c>, both already present.
    /// </summary>
    private static readonly string[] ForbiddenContractPackageFragments =
    {
        "Newtonsoft.Json",
        "Swashbuckle",
        "NSwag",
        "NJsonSchema",
        "AutoMapper",
        "FluentValidation",
        "MediatR",
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
    public void ResponseConventionsAndTransportRecords_ResideInApi()
    {
        // Requirement 11.1 — the response metadata, the conventions, and the transport records are
        // transport concerns and live in the Api assembly, nowhere inner.
        var offenders = ResponseConventions
            .Concat(TransportRecords)
            .Where(type => type.Assembly.GetName().Name != ApiName)
            .Select(type => $"{type.FullName} in '{type.Assembly.GetName().Name}'")
            .ToList();

        Assert.True(
            offenders.Count == 0,
            $"The response conventions and transport records must reside in {ApiName} " +
            $"(Requirement 11.1). Offenders: {Describe(offenders)}.");

        // Non-vacuity: the lists are the real surface, not an empty set that would pass trivially.
        Assert.Equal(6, ResponseConventions.Length);
        Assert.Equal(3, TransportRecords.Length);
    }

    [Fact]
    public void Api_ContainsNoUseCaseHandler()
    {
        // Requirement 11.2 — use cases live in Application; the Api maps endpoints onto them. The
        // per-subsystem suites each assert their own namespace; this one covers the whole assembly, so
        // a handler added under a new Api namespace is caught too. The predicate is shared with
        // Property 21 (see InwardLogicRule) so the two cannot drift apart.
        var offenders = InwardLogicRule.LoadableTypes(ApiAssembly)
            .Where(InwardLogicRule.IsUseCaseHandler)
            .Select(type => type.FullName!)
            .ToList();

        Assert.True(
            offenders.Count == 0,
            $"{ApiName} must contain no use-case handler after the conventions and transport records " +
            $"are added (Requirement 11.2). Offenders: {Describe(offenders)}.");
    }

    [Fact]
    public void Api_ContainsNoEntityTypeConfiguration()
    {
        // Requirement 11.2 — persistence configuration is an Infrastructure concern; the Api declares
        // none. Asserted assembly-wide here, not per subsystem.
        var offenders = InwardLogicRule.LoadableTypes(ApiAssembly)
            .Where(InwardLogicRule.IsEntityTypeConfiguration)
            .Select(type => type.FullName!)
            .ToList();

        Assert.True(
            offenders.Count == 0,
            $"{ApiName} must contain no EF Core IEntityTypeConfiguration<> mapping after the " +
            $"conventions and transport records are added (Requirement 11.2). Offenders: {Describe(offenders)}.");
    }

    [Fact]
    public void Api_CarriesNoRatingOrAggregationTypeInAnyMemberSignature()
    {
        // Requirement 11.2 — no rating arithmetic and no statistics aggregation in the Api: no type in
        // the Api assembly declares, returns, accepts, or holds a rating-engine, display-rating,
        // statistic-calculator, stats-repository, or standing-source type.
        var offenders = InwardLogicRule.LoadableTypes(ApiAssembly)
            .Where(type => InwardLogicRule.CarriesRatingOrAggregationType(type, out _))
            .Select(type => type.FullName!)
            .Distinct(StringComparer.Ordinal)
            .ToList();

        Assert.True(
            offenders.Count == 0,
            $"{ApiName} must carry no rating or aggregation type in any member signature " +
            $"(Requirement 11.2). Offenders: {Describe(offenders)}.");
    }

    [Fact]
    public void TransportRecords_TouchNoDomainOrApplicationType()
    {
        // Requirement 11.2 — the transport records are pure wire shapes: their whole reachable type
        // graph is BCL primitives, so wrapping a scalar in a named envelope smuggles no inward type
        // (and therefore no inward logic) into the transport layer.
        var offenders = new List<string>();

        foreach (var record in TransportRecords)
        {
            foreach (var reached in ReachableTypeGraph(record))
            {
                var owner = reached.Assembly.GetName().Name;
                if (owner is DomainName or ApplicationName or InfrastructureName)
                {
                    offenders.Add($"{record.Name} reaches {reached.FullName} in '{owner}'");
                }
            }
        }

        Assert.True(
            offenders.Count == 0,
            $"The transport records must reach no Domain/Application/Infrastructure type " +
            $"(Requirement 11.2). Offenders: {Describe(offenders)}.");
    }

    [Fact]
    public void AccountReadModelAndStandingAbstraction_ResideInApplication()
    {
        // Requirements 11.3, 11.4 — the account read model, its use case, and the standing abstraction
        // are Application concerns; the standing abstraction sits in the squad namespace with its
        // consumer, so the squad read path needs no reference to the stats use-case namespace.
        var applicationTypes = new[]
        {
            typeof(PitchMate.Application.Auth.UseCases.AccountView),
            typeof(PitchMate.Application.Auth.UseCases.LinkedIdentityView),
            typeof(PitchMate.Application.Auth.UseCases.GetAccountHandler),
            typeof(IMembershipStandingSource),
            typeof(MembershipStanding),
        };

        var offenders = applicationTypes
            .Where(type => type.Assembly.GetName().Name != ApplicationName)
            .Select(type => $"{type.FullName} in '{type.Assembly.GetName().Name}'")
            .ToList();

        Assert.True(
            offenders.Count == 0,
            $"The account read model, its use case, and the standing abstraction must reside in " +
            $"{ApplicationName} (Requirements 11.3, 11.4). Offenders: {Describe(offenders)}.");

        Assert.Equal(StandingAbstractionNamespace, typeof(IMembershipStandingSource).Namespace);
        Assert.Equal(StandingAbstractionNamespace, typeof(MembershipStanding).Namespace);
    }

    [Fact]
    public void StandingSource_IsImplementedInInfrastructureAndNotInApi()
    {
        // Requirement 11.5 — the standing aggregation is implemented in Infrastructure (the positive
        // half) and nowhere in the Api (the negative half). The implementation is internal to
        // Infrastructure, so it is found reflectively rather than by a type reference — which is also
        // why the Api, which cannot see it, could not host it by accident.
        var inInfrastructure = ConcreteImplementationsIn(InfrastructureAssembly, typeof(IMembershipStandingSource))
            .Select(type => type.FullName!)
            .ToList();

        Assert.True(
            inInfrastructure.Count > 0,
            $"{InfrastructureName} must contain a concrete {nameof(IMembershipStandingSource)} " +
            $"implementation (Requirement 11.5).");

        var offenders = ConcreteImplementationsIn(ApiAssembly, typeof(IMembershipStandingSource))
            .Select(type => type.FullName!)
            .ToList();

        Assert.True(
            offenders.Count == 0,
            $"{ApiName} must contain no {nameof(IMembershipStandingSource)} implementation " +
            $"(Requirement 11.5). Offenders: {Describe(offenders)}.");
    }

    [Fact]
    public void Api_ReferencesNoThirdPartyContractPackage()
    {
        // Requirement 11.8 — the change adds no package. The wire contract is the in-box
        // System.Text.Json converter and the response metadata is the already-pinned ASP.NET Core
        // OpenAPI surface; no third-party serialiser, mapper, or schema generator appears among the
        // Api's referenced assemblies.
        var referenced = ApiAssembly.GetReferencedAssemblies()
            .Select(assembly => assembly.Name ?? string.Empty)
            .ToList();

        var offenders = referenced
            .Where(name => ForbiddenContractPackageFragments.Any(fragment =>
                name.Contains(fragment, StringComparison.OrdinalIgnoreCase)))
            .ToList();

        Assert.True(
            offenders.Count == 0,
            $"{ApiName} must reference no third-party serialisation/mapping/schema package " +
            $"(Requirement 11.8). Offenders: {Describe(offenders)}.");

        // Non-vacuity: the reference list is really populated, so the scan above is not passing on an
        // empty set.
        Assert.Contains("System.Text.Json", referenced);
    }

    /// <summary>
    /// Walks the transitive type graph reachable from <paramref name="root"/> through its public
    /// instance properties, excluding the root itself, so a transport record's whole wire shape can be
    /// inspected rather than only its immediate members.
    /// </summary>
    private static IEnumerable<Type> ReachableTypeGraph(Type root)
    {
        var seen = new HashSet<Type> { root };
        var queue = new Queue<Type>();
        queue.Enqueue(root);

        while (queue.Count > 0)
        {
            var current = queue.Dequeue();

            foreach (var property in current.GetProperties(BindingFlags.Public | BindingFlags.Instance))
            {
                foreach (var candidate in Unwrap(property.PropertyType))
                {
                    if (seen.Add(candidate))
                    {
                        queue.Enqueue(candidate);
                        yield return candidate;
                    }
                }
            }
        }
    }

    /// <summary>Expands a member type into the types it actually carries (element and generic argument types included).</summary>
    private static IEnumerable<Type> Unwrap(Type type)
    {
        yield return type;

        if (type.IsArray && type.GetElementType() is { } element)
        {
            yield return element;
        }

        if (type.IsGenericType)
        {
            foreach (var argument in type.GetGenericArguments())
            {
                yield return argument;
            }
        }
    }

    private static IEnumerable<Type> ConcreteImplementationsIn(Assembly assembly, Type abstraction) =>
        InwardLogicRule.LoadableTypes(assembly)
            .Where(type => type is { IsClass: true, IsAbstract: false } && abstraction.IsAssignableFrom(type));

    private static string Describe(IReadOnlyCollection<string> offenders) =>
        offenders.Count == 0 ? "(none)" : string.Join("; ", offenders);
}
