using System.Reflection;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Matches.UseCases;
using PitchMate.Domain.Matches;

namespace PitchMate.Api.Tests.Contracts;

/// <summary>
/// Discovers the read contracts of the <c>match-read-models</c> chore rather than listing them, so the
/// guards built on it (tasks 7.6 and 7.8) cover the list read today and pick up the detail and
/// working-teams reads when tasks 10 and 11 land, with no edit.
/// <para>
/// <b>How a chore read is recognised.</b> Every read this chore adds is a handler in
/// <c>PitchMate.Application.Matches.UseCases</c> that answers through a projection port — an
/// <c>I…Source</c> interface in <c>PitchMate.Application.Matches.Abstractions</c> — rather than through
/// the aggregate repositories the lifecycle writes use. Its contract is the <c>T</c> of the
/// <c>Task&lt;Result&lt;T&gt;&gt;</c> its <c>HandleAsync</c> returns.
/// </para>
/// </summary>
public static class MatchReadContracts
{
    private static readonly Assembly ApplicationAssembly = typeof(GetMatchListHandler).Assembly;

    private static readonly string UseCasesNamespace = typeof(GetMatchListHandler).Namespace!;

    private static readonly string AbstractionsNamespace = typeof(IMatchListSource).Namespace!;

    /// <summary>The handlers of the chore's reads, in name order.</summary>
    public static IReadOnlyList<Type> Handlers { get; } =
    [
        .. ApplicationAssembly.GetTypes()
            .Where(static type => type.Namespace == UseCasesNamespace
                && type.IsClass
                && type.Name.EndsWith("Handler", StringComparison.Ordinal)
                && type.GetConstructors().Any(static ctor => ctor.GetParameters().Any(static p => IsProjectionPort(p.ParameterType))))
            .OrderBy(static type => type.Name, StringComparer.Ordinal),
    ];

    /// <summary>The success contracts of the chore's reads — the bodies their endpoints answer with.</summary>
    public static IReadOnlyList<Type> Contracts { get; } =
        [.. Handlers.Select(ContractOf).Distinct()];

    /// <summary>
    /// Every contract type reachable from <see cref="Contracts"/> through properties and collection
    /// elements, roots included, restricted to PitchMate's own record types.
    /// </summary>
    public static IReadOnlyList<Type> ReachableContracts { get; } = Reach(Contracts);

    /// <summary>
    /// The reachable contracts that declare a <see cref="MatchState"/> member — the ones whose other
    /// members are state-dependent.
    /// </summary>
    public static IReadOnlyList<Type> StateDependentContracts { get; } =
    [
        .. ReachableContracts.Where(static type =>
            type.GetProperties(BindingFlags.Public | BindingFlags.Instance)
                .Any(static property => property.PropertyType == typeof(MatchState))),
    ];

    /// <summary>Whether <paramref name="type"/> is a projection port of the matches feature.</summary>
    private static bool IsProjectionPort(Type type) =>
        type.IsInterface
        && type.Namespace == AbstractionsNamespace
        && type.Name.StartsWith('I')
        && type.Name.EndsWith("Source", StringComparison.Ordinal);

    /// <summary>The <c>T</c> of a handler's <c>Task&lt;Result&lt;T&gt;&gt; HandleAsync</c>.</summary>
    private static Type ContractOf(Type handler)
    {
        MethodInfo handle = handler.GetMethod("HandleAsync")
            ?? throw new InvalidOperationException($"{handler.Name} declares no HandleAsync.");

        Type returned = handle.ReturnType;
        Type result = returned.IsGenericType && returned.GetGenericTypeDefinition() == typeof(Task<>)
            ? returned.GetGenericArguments()[0]
            : throw new InvalidOperationException($"{handler.Name}.HandleAsync does not return a Task<…>.");

        return result.IsGenericType && result.GetGenericTypeDefinition() == typeof(Result<>)
            ? result.GetGenericArguments()[0]
            : throw new InvalidOperationException($"{handler.Name}.HandleAsync does not return a Task<Result<…>>.");
    }

    /// <summary>Walks properties and collection elements from the roots, keeping PitchMate's own records.</summary>
    private static IReadOnlyList<Type> Reach(IEnumerable<Type> roots)
    {
        var seen = new List<Type>();
        var pending = new Queue<Type>(roots);

        while (pending.TryDequeue(out Type? type))
        {
            if (!IsContractType(type) || seen.Contains(type))
            {
                continue;
            }

            seen.Add(type);

            foreach (PropertyInfo property in type.GetProperties(BindingFlags.Public | BindingFlags.Instance))
            {
                pending.Enqueue(ElementOrSelf(property.PropertyType));
            }
        }

        return seen;
    }

    /// <summary>A collection's element type, a nullable's underlying type, or the type itself.</summary>
    public static Type ElementOrSelf(Type type)
    {
        Type unwrapped = Nullable.GetUnderlyingType(type) ?? type;

        if (unwrapped == typeof(string))
        {
            return unwrapped;
        }

        Type? enumerable = unwrapped.IsGenericType && unwrapped.GetGenericTypeDefinition() == typeof(IEnumerable<>)
            ? unwrapped
            : unwrapped.GetInterfaces().FirstOrDefault(static candidate =>
                candidate.IsGenericType && candidate.GetGenericTypeDefinition() == typeof(IEnumerable<>));

        Type element = enumerable?.GetGenericArguments()[0] ?? unwrapped;
        return Nullable.GetUnderlyingType(element) ?? element;
    }

    /// <summary>Whether a type is one of PitchMate's own non-enum contract types.</summary>
    private static bool IsContractType(Type type) =>
        !type.IsEnum
        && !type.IsPrimitive
        && type.Namespace?.StartsWith("PitchMate.", StringComparison.Ordinal) == true;
}
