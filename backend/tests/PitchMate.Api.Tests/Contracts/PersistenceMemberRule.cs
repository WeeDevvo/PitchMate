using System.Collections;
using System.Reflection;
using PitchMate.Domain.Common;

namespace PitchMate.Api.Tests.Contracts;

/// <summary>
/// The persistence-member rule of Requirement 8.6, as a single walk over the type graph reachable from
/// one declared response contract, plus the projection that reads the match surface's declared contracts
/// off the endpoints the running host mapped.
/// <para>
/// <b>Validates: Requirements 8.3, 8.6, 8.7, 8.8</b>
/// </para>
/// <para>
/// The rule is one sentence: <i>no member reachable from a match response contract is declared by
/// <see cref="BaseEntity"/></i>. That is the defect <c>PUT .../availability</c> shipped with — it
/// declared the <c>AvailabilityResponse</c> <em>persistence entity</em> as its response contract, so
/// every response put <c>id</c>, <c>createdAt</c>, <c>updatedAt</c>, <c>createdBy</c>, <c>updatedBy</c>,
/// <c>isDeleted</c> and <c>deletedAt</c> on the wire, disclosing which user last modified a row and
/// whether the row was soft-deleted. Task 2.1 replaced that contract; this keeps it replaced, and keeps
/// the next contract from arriving the same way.
/// </para>
/// <para>
/// <b>Detection is by declaring type, never by member name</b> (Requirement 8.6). A contract legitimately
/// carries its own <c>matchId</c>, and a read may legitimately report a <c>completedAt</c> instant; what
/// must not cross the wire is a member <see cref="BaseEntity"/> itself declares. Reflection makes the
/// distinction exactly: <see cref="MemberInfo.DeclaringType"/> of an inherited audit property is
/// <see cref="BaseEntity"/>, while a record's own positional member — however it is spelled — is declared
/// by the record. A name-based rule would both miss a renamed audit column and condemn every contract
/// that reports an identity, which is to say it would be abandoned within a month.
/// </para>
/// <para>
/// The walk follows <b>declared members</b> (public instance properties and fields — what the serialiser
/// writes), through <b>collection and array element types</b> and through <b>nested types</b>, and
/// terminates on <b>self-references and mutual references</b> because each root's traversal keeps its own
/// visited set. Deriving from <see cref="BaseEntity"/> needs no separate check: a contract that is an
/// entity exposes that base's members and is caught by the same pass, which is why Requirement 8.8's
/// "derives from no persistence base entity" and 8.3's "carries no such member" are one rule here rather
/// than two.
/// </para>
/// <para>
/// The rule lives here, on its own, for the reason <see cref="RouteParameterRule"/> does: it is applied
/// to more than one subject. <see cref="PersistenceMemberWalkProperties"/> applies it exhaustively to
/// every contract the running host declares for a match operation, and to test-only contracts built to
/// break it. A rule restated at each site would be two rules, and the looser would be the one that
/// stayed green.
/// </para>
/// </summary>
internal static class PersistenceMemberRule
{
    /// <summary>
    /// The persistence base entity whose declared members must not cross the wire — the identity, the
    /// creation and update instants, the creating and updating actors, the soft-delete flag and the
    /// deletion instant (Requirement 8.3).
    /// </summary>
    public static readonly Type PersistenceBaseEntity = typeof(BaseEntity);

    /// <summary>
    /// The types the walk treats as leaves: it reports no member of them and follows nothing through
    /// them.
    /// <para>
    /// These are the wire scalars — a <c>string</c>, a <c>Guid</c>, a <see cref="DateTimeOffset"/>, an
    /// <c>int</c>, an enum member. Expanding them would add thousands of framework types to every
    /// traversal (<see cref="DateTimeOffset"/> alone reaches the calendar and time-zone graphs) without
    /// ever reaching <see cref="BaseEntity"/>, which no framework type can declare a member of. Note
    /// that leafness is decided <em>after</em> a member's type is unwrapped, so an
    /// <c>IReadOnlyList&lt;SomeEntity&gt;</c> is followed to <c>SomeEntity</c> rather than stopped at the
    /// collection.
    /// </para>
    /// </summary>
    private static readonly HashSet<Type> WireScalars =
    [
        typeof(string),
        typeof(object),
        typeof(Guid),
        typeof(decimal),
        typeof(DateTime),
        typeof(DateTimeOffset),
        typeof(DateOnly),
        typeof(TimeOnly),
        typeof(TimeSpan),
        typeof(Uri),
    ];

    /// <summary>
    /// Applies the rule to one contract (Requirements 8.3, 8.6).
    /// </summary>
    /// <param name="contract">The declared response contract to walk.</param>
    /// <returns>
    /// One message per reachable member whose declaring type is the persistence base entity, each naming
    /// the contract, the path the member was reached by, the member and its declaring type; empty when
    /// the contract's whole reachable graph is clean.
    /// </returns>
    public static IReadOnlyList<string> PersistenceMembersOf(Type contract)
    {
        ArgumentNullException.ThrowIfNull(contract);

        return Walk(contract).Violations;
    }

    /// <summary>
    /// Applies the rule across a set of contracts, gathering every offender so the message is a worklist
    /// rather than a single first failure.
    /// </summary>
    /// <param name="contracts">The contracts to walk.</param>
    /// <returns>One message per violation across the whole set.</returns>
    public static IReadOnlyList<string> PersistenceMembersOf(IEnumerable<Type> contracts)
    {
        ArgumentNullException.ThrowIfNull(contracts);

        return [.. contracts.SelectMany(PersistenceMembersOf)];
    }

    /// <summary>
    /// Every type the walk reaches from <paramref name="contract"/>, the contract itself first. This is
    /// what the non-vacuity floor counts: a walk that followed nothing would report nothing, and would do
    /// so while looking perfectly green.
    /// </summary>
    /// <param name="contract">The contract to walk.</param>
    /// <returns>The reached types, in discovery order, each appearing once.</returns>
    public static IReadOnlyList<Type> TypeGraphOf(Type contract)
    {
        ArgumentNullException.ThrowIfNull(contract);

        return Walk(contract).Reached;
    }

    /// <summary>
    /// Whether <paramref name="message"/> is a violation reported against <paramref name="contract"/>.
    /// Matched on the message's leading <c>"{contract} carries"</c>, so a contract whose name is a prefix
    /// of another's cannot absorb its offences.
    /// </summary>
    /// <param name="message">A message returned by the rule.</param>
    /// <param name="contract">The contract to attribute it to.</param>
    /// <returns><see langword="true"/> when the message names that contract as the offending root.</returns>
    public static bool IsReportedAgainst(string message, Type contract)
    {
        ArgumentNullException.ThrowIfNull(message);
        ArgumentNullException.ThrowIfNull(contract);

        return message.StartsWith($"{contract.Name} carries", StringComparison.Ordinal);
    }

    /// <summary>
    /// The members <see cref="BaseEntity"/> itself declares — the set the rule looks for, read off the
    /// type rather than listed, so an audit column added to the base enters the guard with it.
    /// </summary>
    /// <returns>The declared member names.</returns>
    public static IReadOnlyList<string> PersistenceBaseEntityMemberNames() =>
    [
        .. WireMembersOf(PersistenceBaseEntity)
            .Where(static member => member.DeclaringType == PersistenceBaseEntity)
            .Select(static member => member.Name)
            .Order(StringComparer.Ordinal),
    ];

    /// <summary>
    /// Reads the declared response contracts of the match surface off the endpoints the running host
    /// mapped (Requirement 8.3).
    /// <para>
    /// <b>Which endpoints belong to the match surface is discovered, not listed.</b> The predicate is
    /// <see cref="RouteParameterRule.IsMatchPath"/> — a literal <c>matches</c> segment — which picks up
    /// both route groups, the squad-scoped <c>/squads/{squadId:guid}/matches/...</c> and the per-match
    /// <c>/matches/{matchId:guid}/...</c>, without this projection naming either prefix. The declared
    /// contracts then come from the framework's own
    /// <see cref="Microsoft.AspNetCore.Http.Metadata.IProducesResponseTypeMetadata"/>, already projected
    /// by <see cref="MappedEndpoint"/>, so this reuses the endpoint discovery the other guards of this
    /// folder run on rather than standing up a second one.
    /// </para>
    /// <para>
    /// <b>Every</b> declared body type is returned, the problem body included, because Requirement 8.3
    /// is a statement about every match response contract and not only the success ones — a problem body
    /// that carried a soft-delete flag would disclose exactly as much. Bodiless declarations
    /// (<c>204</c>) contribute nothing and drop out.
    /// </para>
    /// </summary>
    /// <param name="endpoints">The endpoints the running host reported.</param>
    /// <returns>The distinct declared contract types, ordered by full name for stable failure output.</returns>
    public static IReadOnlyList<Type> MatchResponseContractsOf(IEnumerable<MappedEndpoint> endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        return
        [
            .. endpoints
                .Where(static endpoint => RouteParameterRule.IsMatchPath(endpoint.Route))
                .SelectMany(static endpoint => endpoint.DeclaredResponses)
                .Select(static response => response.BodyType)
                .OfType<Type>()
                .Distinct()
                .OrderBy(static contract => contract.FullName, StringComparer.Ordinal),
        ];
    }

    /// <summary>
    /// The one traversal both public readings share, so the types the floor counts are exactly the types
    /// the rule judged.
    /// <para>
    /// Breadth-first from the contract, carrying the member path each type was reached by so a violation
    /// names where it sits rather than only what it is. The visited set is per-root and is consulted
    /// before enqueueing, which is what bounds a self-referencing or mutually-referencing contract: it is
    /// reached once, expanded once, and never re-entered.
    /// </para>
    /// </summary>
    private static (IReadOnlyList<string> Violations, IReadOnlyList<Type> Reached) Walk(Type contract)
    {
        var violations = new List<string>();
        var reached = new List<Type> { contract };
        var visited = new HashSet<Type> { contract };
        var frontier = new Queue<(Type Type, string Path)>();

        frontier.Enqueue((contract, contract.Name));

        while (frontier.Count > 0)
        {
            (Type type, string path) = frontier.Dequeue();

            foreach (MemberInfo member in WireMembersOf(type))
            {
                if (member.DeclaringType == PersistenceBaseEntity)
                {
                    violations.Add(
                        $"{contract.Name} carries '{path}.{member.Name}', a member declared by "
                            + $"{PersistenceBaseEntity.Name} ({PersistenceBaseEntity.FullName}).");

                    continue;
                }

                foreach (Type carried in CarriedTypesOf(WireTypeOf(member)))
                {
                    if (!IsFollowed(carried) || !visited.Add(carried))
                    {
                        continue;
                    }

                    reached.Add(carried);
                    frontier.Enqueue((carried, $"{path}.{member.Name}"));
                }
            }
        }

        return (violations, reached);
    }

    /// <summary>
    /// The members of <paramref name="type"/> that cross the wire: its public instance properties that
    /// can be read, and its public instance fields. Indexers are excluded — an indexer is a collection's
    /// accessor rather than a serialised member, and following one would re-enter the element type the
    /// collection was already unwrapped to.
    /// </summary>
    private static IEnumerable<MemberInfo> WireMembersOf(Type type) =>
        type.GetProperties(BindingFlags.Public | BindingFlags.Instance)
            .Where(static property => property.CanRead && property.GetIndexParameters().Length == 0)
            .Cast<MemberInfo>()
            .Concat(type.GetFields(BindingFlags.Public | BindingFlags.Instance));

    /// <summary>The type a wire member carries.</summary>
    private static Type WireTypeOf(MemberInfo member) => member switch
    {
        PropertyInfo property => property.PropertyType,
        FieldInfo field => field.FieldType,
        _ => throw new InvalidOperationException(
            $"'{member.Name}' is a {member.MemberType}, which the wire-member walk does not enumerate."),
    };

    /// <summary>
    /// Expands a member's type into the types it actually carries: a nullable to its underlying type, an
    /// array to its element type, a generic collection to its element types, and anything else to itself.
    /// <para>
    /// Collections are <b>transparent</b> rather than followed — the walk cares about the shape a client
    /// reads, and an <c>IReadOnlyList&lt;T&gt;</c> publishes <c>T</c>. This is the conjunct of Requirement
    /// 8.6 about "collection and array element types", and it is what makes a planted
    /// <c>IReadOnlyList&lt;SomeEntity&gt;</c> or <c>SomeEntity[]</c> member detectable rather than hidden
    /// one level down.
    /// </para>
    /// </summary>
    private static IEnumerable<Type> CarriedTypesOf(Type type)
    {
        if (type.IsByRef || type.IsPointer || type.IsGenericParameter)
        {
            yield break;
        }

        if (Nullable.GetUnderlyingType(type) is { } underlying)
        {
            foreach (Type carried in CarriedTypesOf(underlying))
            {
                yield return carried;
            }

            yield break;
        }

        if (type.IsArray)
        {
            if (type.GetElementType() is { } element)
            {
                foreach (Type carried in CarriedTypesOf(element))
                {
                    yield return carried;
                }
            }

            yield break;
        }

        if (type != typeof(string)
            && type.IsGenericType
            && typeof(IEnumerable).IsAssignableFrom(type))
        {
            foreach (Type argument in type.GetGenericArguments())
            {
                foreach (Type carried in CarriedTypesOf(argument))
                {
                    yield return carried;
                }
            }

            yield break;
        }

        yield return type;
    }

    /// <summary>
    /// Whether the walk follows into a carried type — everything except the wire scalars and enums (see
    /// <see cref="WireScalars"/>).
    /// </summary>
    private static bool IsFollowed(Type type) =>
        !type.IsPrimitive
            && !type.IsEnum
            && type != typeof(void)
            && !WireScalars.Contains(type);
}
