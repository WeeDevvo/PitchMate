using System.Reflection;
using Microsoft.EntityFrameworkCore;
using PitchMate.Application.LiveTracking;
using PitchMate.Application.Stats;
using PitchMate.Domain.Common;
using PitchMate.Domain.LiveTracking;
using PitchMate.Infrastructure.LiveTracking;

namespace PitchMate.Api.Tests.Architecture;

/// <summary>
/// Architecture / dependency-rule tests enforcing the Clean Architecture layering of the
/// live-tracking subsystem on every <c>dotnet test</c> run, so the placement of live-tracking logic
/// cannot regress unnoticed and a violating reference fails the build (Requirement 14).
///
/// Complements <c>PitchMate.Infrastructure.Tests.Architecture.LiveTrackingArchitecturePlacementTests</c>:
/// that suite proves the inner layers (Domain/Application/Infrastructure) hold the event-log entities,
/// the derivation value objects, the use cases, the <c>IMatchEventRepository</c> interface, and the
/// EF/repository/rich-stats implementations in the right place (Req 14.1–14.3); this suite (which can
/// see the <c>PitchMate.Api</c> assembly) proves the rule that requires the Api assembly to assert —
/// that the Api references Infrastructure for DI wiring and endpoint mapping only and contains no
/// live-tracking business, derivation, or rating logic: no event-log repository or rich-stats
/// implementation, no use-case handlers, no MatchEvent entity definitions, no EF Core mappings, and no
/// reference to the derivation/validation logic (Req 14.4), keeping the inward-only dependency rule
/// enforceable and reporting all offenders together (Req 14.6).
///
/// Requirement 14.5 (the web, mobile, and watch clients never reference the Domain project or the
/// live-tracking implementation and record/read live detail only via the API) is enforced by
/// construction rather than by a runtime assertion: the clients are TypeScript (web) and Swift (watch)
/// / React Native (mobile) projects that cannot reference a .NET assembly, and the only .NET client of
/// the backend — <c>PitchMate.Api</c> — reaches live-tracking logic solely through the Application
/// handlers and <c>PitchMate.Infrastructure</c> DI wiring, which the checks below confirm carries no
/// live-tracking implementation or derivation itself.
///
/// The approach is dependency-free (<see cref="System.Reflection"/> only): scanning concrete types
/// catches a mis-placed implementation, and positive checks confirm the live-tracking abstractions are
/// implemented in Infrastructure rather than the Api.
/// </summary>
public class LiveTrackingLayeringAndImplementationLocationTests
{
    private const string DomainName = "PitchMate.Domain";
    private const string ApplicationName = "PitchMate.Application";
    private const string InfrastructureName = "PitchMate.Infrastructure";
    private const string ApiName = "PitchMate.Api";

    // Anchor types create a hard compile-time and runtime link to each asserted assembly, so a build
    // with a renamed/missing assembly fails to compile rather than passing this suite silently. The
    // Infrastructure anchor is the public registration entry point, since the repository and rich-stats
    // implementations are internal to the Infrastructure assembly.
    private static readonly Assembly DomainAssembly = typeof(MatchEvent).Assembly;
    private static readonly Assembly ApplicationAssembly = typeof(IMatchEventRepository).Assembly;
    private static readonly Assembly InfrastructureAssembly = typeof(LiveTrackingInfrastructureRegistration).Assembly;
    private static readonly Assembly ApiAssembly = typeof(Program).Assembly;

    /// <summary>The live-tracking abstractions whose implementations must live in Infrastructure, never in Api.</summary>
    private static readonly Type[] LiveTrackingInfrastructureAbstractions =
    {
        typeof(IMatchEventRepository),
        typeof(IRichStatsSource),
    };

    /// <summary>The Domain derivation/validation logic the Api must never reference (Req 14.4).</summary>
    private static readonly Type[] LiveTrackingDerivationTypes =
    {
        typeof(MatchEventLog),
        typeof(MatchEventValidation),
        typeof(EventIdPolicy),
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
    public void LiveTrackingAbstractions_AreImplementedInInfrastructure()
    {
        // Requirement 14.3 — the append-only event repository and the rich-stats seam have a concrete
        // implementation in Infrastructure, so persistence and derivation live there and not in the Api.
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
    public void LiveTrackingAbstractions_AreNotImplementedInApi()
    {
        // Requirement 14.4 — the event-log repository and the rich-stats source stay out of the Api
        // project; the Api references Infrastructure for DI wiring only.
        var offenders = LiveTrackingInfrastructureAbstractions
            .SelectMany(abstraction =>
                ConcreteImplementationsIn(ApiAssembly, abstraction)
                    .Select(impl => $"{impl.FullName} implements {abstraction.Name}"))
            .ToList();

        Assert.True(
            offenders.Count == 0,
            $"{ApiName} must contain no live-tracking repository/rich-stats implementation " +
            $"(Requirement 14.4). Offenders: {Describe(offenders)}.");
    }

    [Fact]
    public void Api_ContainsNoLiveTrackingUseCaseImplementations()
    {
        // Requirement 14.4 — live-tracking use cases (handlers) live in Application; the Api only maps
        // endpoints onto them. No live-tracking use-case handler type may appear in the Api assembly.
        var offenders = LoadableTypes(ApiAssembly)
            .Where(type => type is { IsClass: true, IsAbstract: false })
            .Where(type =>
                (type.Namespace?.Contains(".LiveTracking", StringComparison.Ordinal) ?? false)
                && type.Name.EndsWith("Handler", StringComparison.Ordinal))
            .Select(type => type.FullName!)
            .ToList();

        Assert.True(
            offenders.Count == 0,
            $"{ApiName} must contain no live-tracking use-case implementations (Requirement 14.4). " +
            $"Offenders: {Describe(offenders)}.");
    }

    [Fact]
    public void Api_ContainsNoMatchEventEntityDefinitions()
    {
        // Requirement 14.4 — the MatchEvent hierarchy is defined in Domain; the Api holds none. Any
        // BaseEntity subclass in the Api assembly is a mis-placed entity definition.
        var offenders = LoadableTypes(ApiAssembly)
            .Where(type => type is { IsClass: true, IsAbstract: false }
                           && typeof(BaseEntity).IsAssignableFrom(type))
            .Select(type => type.FullName!)
            .ToList();

        Assert.True(
            offenders.Count == 0,
            $"{ApiName} must contain no entity definitions (Requirement 14.4). Offenders: {Describe(offenders)}.");
    }

    [Fact]
    public void Api_ContainsNoEfCoreMappings()
    {
        // Requirement 14.4 — EF Core mappings (including the MatchEvent table-per-hierarchy mapping)
        // are an Infrastructure concern; the Api declares none.
        var offenders = LoadableTypes(ApiAssembly)
            .Where(type => type is { IsClass: true, IsAbstract: false } && ImplementsEntityConfiguration(type))
            .Select(type => type.FullName!)
            .ToList();

        Assert.True(
            offenders.Count == 0,
            $"{ApiName} must contain no EF Core IEntityTypeConfiguration<> mappings (Requirement 14.4). " +
            $"Offenders: {Describe(offenders)}.");
    }

    [Fact]
    public void Api_ContainsNoDerivationOrRatingLogic()
    {
        // Requirement 14.4 — the Api holds no live-tracking derivation or rating logic: no type in the
        // Api assembly references the MatchEventLog projection, the per-event validation, or the
        // Event_Id policy. An IL member-reference scan catches an accidental derivation call added in an
        // endpoint or adapter. Derivation and the single rating update stay in Domain / Application.
        var derivationTypeNames = LiveTrackingDerivationTypes
            .Select(type => type.FullName!)
            .ToHashSet(StringComparer.Ordinal);

        var offenders = LoadableTypes(ApiAssembly)
            .Where(type => ReferencesAny(type, derivationTypeNames))
            .Select(type => type.FullName!)
            .Distinct()
            .ToList();

        Assert.True(
            offenders.Count == 0,
            $"{ApiName} must contain no live-tracking derivation or rating logic and must not reference " +
            $"the MatchEventLog projection or the recording validation (Requirement 14.4). " +
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
