using System.Reflection;
using System.Runtime.CompilerServices;
using Microsoft.EntityFrameworkCore;
using PitchMate.Application.Squads.Abstractions;

namespace PitchMate.Api.Tests.Architecture;

/// <summary>
/// The inward-logic rule of Requirement 11.2, as a single predicate over one <see cref="Type"/>.
/// <para>
/// <b>Validates: Requirement 11.2</b>
/// </para>
/// <para>
/// The rule lives here, on its own, for the same reason
/// <see cref="PitchMate.Api.Tests.Contracts.SuccessDeclarationRule"/> does: two tests need to apply it,
/// and a rule applied twice is a rule that can be satisfied twice differently. The architecture suite
/// (<see cref="ResponseContractLayeringTests"/>) applies it to the <c>PitchMate.Api</c> assembly;
/// Property 21 (<see cref="ApiInwardLogicProperties"/>) applies it to that same assembly <i>and</i> to
/// types planted in the test assembly precisely to break it, so the rule is shown to have teeth. Had
/// the property re-expressed the rule in its own words, the two could drift, and the looser one would
/// be the one that stayed green.
/// </para>
/// <para>
/// It states the three things a transport-layer type must not be (Requirement 11.2):
/// </para>
/// <list type="bullet">
/// <item>a <b>use-case handler</b> — use cases are Application work, the Api maps endpoints onto
/// them;</item>
/// <item>an <b>entity type configuration</b> — persistence mapping is Infrastructure work;</item>
/// <item>a carrier of <b>rating or statistics-aggregation</b> types in any member signature — the proxy
/// for "contains no rating or aggregation arithmetic", since a type that performs such arithmetic has
/// to name its inputs somewhere in its surface.</item>
/// </list>
/// <para>
/// Every violation of a type is returned rather than the first, and each message names the type's full
/// name and the conjunct it broke, because an unnamed offender is not findable in the source.
/// </para>
/// <para>
/// <see cref="System.Reflection"/> only, in the idiom of the sibling suites, adding no test package
/// (Requirement 11.8). The complementary source-level half of the property — Requirement 11.6, which
/// no reflection can see — is <see cref="InwardLogicSourceScan"/>.
/// </para>
/// </summary>
internal static class InwardLogicRule
{
    /// <summary>
    /// The rating and statistics-aggregation types the Api must not carry in any member signature. The
    /// rating engine, its configuration, its inputs and its classification surface cover "no rating
    /// arithmetic"; the statistic calculators, the stats repository and the standing source cover "no
    /// statistics aggregation".
    /// </summary>
    public static readonly IReadOnlyList<Type> RatingAndAggregationTypes =
    [
        typeof(PitchMate.Domain.Rating.IRatingEngine),
        typeof(PitchMate.Domain.Rating.Rating),
        typeof(PitchMate.Domain.Rating.RatingEngineConfig),
        typeof(PitchMate.Domain.Rating.MatchOutcome),
        typeof(PitchMate.Domain.Rating.MatchUpdate),
        typeof(PitchMate.Domain.Stats.DisplayRatingCalculator),
        typeof(PitchMate.Domain.Stats.DisplayRatingParameters),
        typeof(PitchMate.Domain.Stats.StreakCalculator),
        typeof(PitchMate.Domain.Stats.WinPercentage),
        typeof(PitchMate.Domain.Stats.RatingSummary),
        typeof(PitchMate.Application.Stats.IStatsRepository),
        typeof(PitchMate.Application.Stats.IRichStatsSource),
        typeof(IMembershipStandingSource),
        typeof(MembershipStanding),
    ];

    private static readonly IReadOnlySet<string> ForbiddenTypeNames =
        RatingAndAggregationTypes.Select(static type => type.FullName!).ToHashSet(StringComparer.Ordinal);

    /// <summary>
    /// Applies the rule to one type.
    /// </summary>
    /// <param name="type">The type to judge.</param>
    /// <returns>
    /// One message per violation, each naming the type and the conjunct it broke; empty when the type
    /// carries no inward logic.
    /// </returns>
    public static IReadOnlyList<string> Violations(Type type)
    {
        ArgumentNullException.ThrowIfNull(type);

        var violations = new List<string>();
        string name = type.FullName ?? type.Name;

        if (IsUseCaseHandler(type))
        {
            violations.Add(
                $"{name} is a use-case handler; use cases live in PitchMate.Application "
                    + "(Requirement 11.2).");
        }

        if (IsEntityTypeConfiguration(type))
        {
            violations.Add(
                $"{name} implements IEntityTypeConfiguration<>; persistence configuration lives in "
                    + "PitchMate.Infrastructure (Requirement 11.2).");
        }

        if (CarriesRatingOrAggregationType(type, out string? carried))
        {
            violations.Add(
                $"{name} carries {carried} in a member signature; the Api performs no rating "
                    + "arithmetic and no statistics aggregation (Requirement 11.2).");
        }

        return violations;
    }

    /// <summary>
    /// Applies the rule across a set of types, gathering every offender so the message is a worklist
    /// rather than a single first failure.
    /// </summary>
    /// <param name="types">The types to judge.</param>
    /// <returns>One message per violation across the whole set.</returns>
    public static IReadOnlyList<string> Violations(IEnumerable<Type> types)
    {
        ArgumentNullException.ThrowIfNull(types);

        return [.. types.SelectMany(Violations)];
    }

    /// <summary>
    /// Returns whether the type is a use-case handler. A handler is recognised the way the sibling
    /// suites recognise one — by the <c>Handler</c> suffix or by sitting under a <c>UseCases</c>
    /// namespace — so a handler added under a new namespace is caught without this rule being edited.
    /// </summary>
    /// <param name="type">The type to judge.</param>
    /// <returns><see langword="true"/> when the type is a use-case handler.</returns>
    public static bool IsUseCaseHandler(Type type)
    {
        ArgumentNullException.ThrowIfNull(type);

        return type is { IsClass: true, IsAbstract: false }
            && !IsCompilerGenerated(type)
            && (type.Name.EndsWith("Handler", StringComparison.Ordinal)
                || (type.Namespace?.Contains(".UseCases", StringComparison.Ordinal) ?? false));
    }

    /// <summary>Returns whether the type declares an EF Core entity mapping.</summary>
    /// <param name="type">The type to judge.</param>
    /// <returns><see langword="true"/> when the type implements <see cref="IEntityTypeConfiguration{TEntity}"/>.</returns>
    public static bool IsEntityTypeConfiguration(Type type)
    {
        ArgumentNullException.ThrowIfNull(type);

        return type is { IsClass: true, IsAbstract: false }
            && type.GetInterfaces().Any(static i =>
                i.IsGenericType && i.GetGenericTypeDefinition() == typeof(IEntityTypeConfiguration<>));
    }

    /// <summary>
    /// Returns whether any member of the type declares, returns, accepts, or (for its fields) holds one
    /// of the <see cref="RatingAndAggregationTypes"/> — the same reflection-only proxy for a type-level
    /// dependency the sibling suites use, needing no extra test package.
    /// </summary>
    /// <param name="type">The type to judge.</param>
    /// <param name="carried">The offending type's full name, when one is found.</param>
    /// <returns><see langword="true"/> when the type carries a rating or aggregation type.</returns>
    public static bool CarriesRatingOrAggregationType(Type type, out string? carried)
    {
        ArgumentNullException.ThrowIfNull(type);

        const BindingFlags all = BindingFlags.Public | BindingFlags.NonPublic
            | BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly;

        string? found = null;

        bool Named(Type? candidate)
        {
            if (candidate is null)
            {
                return false;
            }

            if (candidate.FullName is { } name && ForbiddenTypeNames.Contains(name))
            {
                found = name;
                return true;
            }

            // A forbidden type used as a generic argument (IReadOnlyList<Rating>, Result<RatingSummary>)
            // is just as much a dependency as using it directly.
            return candidate.IsGenericType && candidate.GetGenericArguments().Any(Named);
        }

        try
        {
            if (type.GetFields(all).Any(field => Named(field.FieldType)))
            {
                carried = found;
                return true;
            }

            foreach (MethodInfo method in type.GetMethods(all))
            {
                if (Named(method.ReturnType) || method.GetParameters().Any(p => Named(p.ParameterType)))
                {
                    carried = found;
                    return true;
                }
            }

            foreach (ConstructorInfo ctor in type.GetConstructors(all))
            {
                if (ctor.GetParameters().Any(p => Named(p.ParameterType)))
                {
                    carried = found;
                    return true;
                }
            }
        }
        catch (TypeLoadException)
        {
            // A member whose signature cannot be resolved cannot be a static reference we can assert on.
        }

        carried = null;
        return false;
    }

    /// <summary>Returns whether the type (or its declaring type) is compiler-generated rather than authored source.</summary>
    /// <param name="type">The type to judge.</param>
    /// <returns><see langword="true"/> when the type is compiler-generated.</returns>
    public static bool IsCompilerGenerated(Type type)
    {
        ArgumentNullException.ThrowIfNull(type);

        return type.Name.Contains('<', StringComparison.Ordinal)
            || type.IsDefined(typeof(CompilerGeneratedAttribute), inherit: false)
            || (type.DeclaringType is { } declaring && IsCompilerGenerated(declaring));
    }

    /// <summary>
    /// Every type an assembly reports, tolerating a partially loadable assembly so a single
    /// unresolvable type cannot silently empty the population the rule is applied to.
    /// </summary>
    /// <param name="assembly">The assembly to enumerate.</param>
    /// <returns>The loadable types.</returns>
    public static IEnumerable<Type> LoadableTypes(Assembly assembly)
    {
        ArgumentNullException.ThrowIfNull(assembly);

        try
        {
            return assembly.GetTypes();
        }
        catch (ReflectionTypeLoadException ex)
        {
            return ex.Types.Where(static type => type is not null).Select(static type => type!);
        }
    }
}
