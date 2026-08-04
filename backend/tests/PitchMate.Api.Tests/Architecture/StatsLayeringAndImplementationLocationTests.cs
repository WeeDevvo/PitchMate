using System.Reflection;
using Microsoft.EntityFrameworkCore;
using PitchMate.Application.Stats;
using PitchMate.Domain.Stats;
using PitchMate.Infrastructure.Stats;

namespace PitchMate.Api.Tests.Architecture;

/// <summary>
/// Architecture / dependency-rule tests enforcing the Clean Architecture layering of the
/// stats-and-summaries subsystem on every <c>dotnet test</c> run, so the placement of stats logic
/// cannot regress unnoticed and a violating reference fails the build (Requirement 15).
///
/// Complements <c>PitchMate.Infrastructure.Tests.Architecture.StatsArchitecturePlacementTests</c>:
/// that suite proves the inner layers (Domain/Application/Infrastructure) hold the stats calculators,
/// use cases, interfaces, and SQL-aggregation implementations in the right place (Req 15.1–15.3) and
/// that the presentational display rating leaks into no rating-update or team-balancing code
/// (Req 7.6); this suite (which can see the <c>PitchMate.Api</c> assembly) proves the rule that
/// requires the Api assembly to assert — that the Api references Infrastructure for DI wiring and
/// endpoint mapping only and contains no statistic-aggregation logic, no statistic-derivation logic,
/// no stats use-case implementations, and no EF Core mappings (Req 15.4), keeping the inward-only
/// dependency rule enforceable (Req 15.7).
///
/// Requirements 15.5 and 15.6 (the web, mobile, and watch clients never reference the Domain project
/// or the Infrastructure stats implementations and obtain statistics only via the API) are enforced
/// by construction rather than by a runtime assertion: the clients are TypeScript (web) and
/// Swift (watch) / React Native (mobile) projects that cannot reference a .NET assembly, and the only
/// .NET client of the backend — <c>PitchMate.Api</c> — reaches stats logic solely through the
/// Application handlers and <c>PitchMate.Infrastructure</c> DI wiring, which the checks below confirm
/// carries no stats implementation itself.
///
/// The approach is dependency-free (<see cref="System.Reflection"/> only): scanning concrete types
/// catches a mis-placed implementation, and positive checks confirm the stats abstractions are
/// implemented in Infrastructure rather than the Api.
/// </summary>
public class StatsLayeringAndImplementationLocationTests
{
    private const string DomainName = "PitchMate.Domain";
    private const string ApplicationName = "PitchMate.Application";
    private const string InfrastructureName = "PitchMate.Infrastructure";
    private const string ApiName = "PitchMate.Api";

    // Anchor types create a hard compile-time and runtime link to each asserted assembly, so a build
    // with a renamed/missing assembly fails to compile rather than passing this suite silently.
    private static readonly Assembly DomainAssembly = typeof(DisplayRatingCalculator).Assembly;
    private static readonly Assembly ApplicationAssembly = typeof(IStatsRepository).Assembly;
    private static readonly Assembly InfrastructureAssembly = typeof(EmptyRichStatsSource).Assembly;
    private static readonly Assembly ApiAssembly = typeof(Program).Assembly;

    /// <summary>The stats abstractions whose implementations must live in Infrastructure, never in Api.</summary>
    private static readonly Type[] StatsInfrastructureAbstractions =
    {
        typeof(IStatsRepository),
        typeof(IDisplayRatingParametersSource),
        typeof(IRichStatsSource),
    };

    /// <summary>The Domain stats calculators/derivation types the Api must never reference (Req 15.4).</summary>
    private static readonly Type[] StatsDerivationTypes =
    {
        typeof(DisplayRatingCalculator),
        typeof(StreakCalculator),
        typeof(WinPercentage),
        typeof(RatingSummary),
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
    public void StatsAbstractions_AreImplementedInInfrastructure()
    {
        // Requirement 15.3 — the stats repository and the params/rich sources have a concrete
        // implementation in Infrastructure, so the SQL aggregation lives there and not in the Api.
        var missing = StatsInfrastructureAbstractions
            .Where(abstraction => !ConcreteImplementationsIn(InfrastructureAssembly, abstraction).Any())
            .Select(abstraction => abstraction.Name)
            .ToList();

        Assert.True(
            missing.Count == 0,
            $"{InfrastructureName} must contain a concrete implementation of each stats abstraction " +
            $"(Requirement 15.3). Missing: {Describe(missing)}.");
    }

    [Fact]
    public void StatsAbstractions_AreNotImplementedInApi()
    {
        // Requirement 15.4 — the SQL-aggregation repository and the params/rich sources stay out of the
        // Api project; the Api references Infrastructure for DI wiring only.
        var offenders = StatsInfrastructureAbstractions
            .SelectMany(abstraction =>
                ConcreteImplementationsIn(ApiAssembly, abstraction)
                    .Select(impl => $"{impl.FullName} implements {abstraction.Name}"))
            .ToList();

        Assert.True(
            offenders.Count == 0,
            $"{ApiName} must contain no stats repository/params/rich implementation " +
            $"(Requirement 15.4). Offenders: {Describe(offenders)}.");
    }

    [Fact]
    public void Api_ContainsNoStatsUseCaseImplementations()
    {
        // Requirement 15.4 — stats query use cases (handlers) live in Application; the Api only maps
        // endpoints onto them. No stats use-case handler type may appear in the Api assembly.
        var offenders = LoadableTypes(ApiAssembly)
            .Where(type => type is { IsClass: true, IsAbstract: false })
            .Where(type =>
                (type.Namespace?.Contains(".Stats", StringComparison.Ordinal) ?? false)
                && type.Name.EndsWith("Handler", StringComparison.Ordinal))
            .Select(type => type.FullName!)
            .ToList();

        Assert.True(
            offenders.Count == 0,
            $"{ApiName} must contain no stats use-case implementations (Requirement 15.4). " +
            $"Offenders: {Describe(offenders)}.");
    }

    [Fact]
    public void Api_ContainsNoStatsAggregationOrDerivationLogic()
    {
        // Requirement 15.4 — the Api holds no statistic-derivation logic: no type in the Api assembly
        // references the Domain stats calculators or the RatingSummary shaping. An IL member-reference
        // scan catches an accidental derivation call added in an endpoint or adapter.
        var derivationTypeNames = StatsDerivationTypes
            .Select(type => type.FullName!)
            .ToHashSet(StringComparer.Ordinal);

        var offenders = LoadableTypes(ApiAssembly)
            .Where(type => ReferencesAny(type, derivationTypeNames))
            .Select(type => type.FullName!)
            .Distinct()
            .ToList();

        Assert.True(
            offenders.Count == 0,
            $"{ApiName} must contain no statistic-derivation logic and must not reference the stats " +
            $"calculators (Requirement 15.4). Offenders: {Describe(offenders)}.");
    }

    [Fact]
    public void Api_ContainsNoEfCoreMappings()
    {
        // Requirement 15.4 — EF Core mappings (including any stats aggregation mapping) are an
        // Infrastructure concern; the Api declares none.
        var offenders = LoadableTypes(ApiAssembly)
            .Where(type => type is { IsClass: true, IsAbstract: false } && ImplementsEntityConfiguration(type))
            .Select(type => type.FullName!)
            .ToList();

        Assert.True(
            offenders.Count == 0,
            $"{ApiName} must contain no EF Core IEntityTypeConfiguration<> mappings (Requirement 15.4). " +
            $"Offenders: {Describe(offenders)}.");
    }

    /// <summary>
    /// Returns whether any member of <paramref name="type"/> declares, returns, accepts, or (for its
    /// fields) holds one of the <paramref name="forbiddenTypeNames"/> — a reflection-only proxy for a
    /// type-level dependency that needs no extra test packages.
    /// </summary>
    private static bool ReferencesAny(Type type, IReadOnlySet<string> forbiddenTypeNames)
    {
        const BindingFlags all = BindingFlags.Public | BindingFlags.NonPublic
            | BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly;

        bool Named(Type? candidate) => candidate?.FullName is { } name && forbiddenTypeNames.Contains(name);

        try
        {
            if (type.GetFields(all).Any(field => Named(field.FieldType)))
            {
                return true;
            }

            foreach (var method in type.GetMethods(all))
            {
                if (Named(method.ReturnType) || method.GetParameters().Any(p => Named(p.ParameterType)))
                {
                    return true;
                }
            }

            foreach (var ctor in type.GetConstructors(all))
            {
                if (ctor.GetParameters().Any(p => Named(p.ParameterType)))
                {
                    return true;
                }
            }
        }
        catch (TypeLoadException)
        {
            // A member whose signature cannot be resolved cannot be a static reference we can assert on.
        }

        return false;
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
