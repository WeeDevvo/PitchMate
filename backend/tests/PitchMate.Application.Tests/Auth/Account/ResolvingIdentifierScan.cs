using System.Reflection;

namespace PitchMate.Application.Tests.Auth.Account;

/// <summary>
/// The walker behind the Account_Non_Disclosure_Guard (<b>Property 16</b>): a transitive reflection
/// walk over the type graph reachable from a read-model root, classifying every member it finds as
/// benign, as a <em>resolving identifier</em> (a provider subject, a password credential, or token
/// material), or as an identity id.
/// <para>
/// Detection is by <b>member name and member type</b>, never by an allow-list of known-bad members,
/// so a disclosing member added to either read model later is caught without this file being edited
/// (Requirement 8.8). A member called <c>ProviderUserId</c>, <c>ProviderSubject</c> or anything
/// ending <c>Subject</c> is a provider subject; anything naming a password or a credential is a
/// password credential; anything naming a token, a secret or a hash is token material. The same
/// vocabulary is applied to the member's <em>carried</em> types — the type itself, an array's element
/// type, a nullable's underlying type and every generic type argument — so a member with a benign
/// name whose type is <c>RefreshToken</c> or <c>PasswordCredential</c> is caught too.
/// </para>
/// <para>
/// The walk is transitive and cycle-guarded: record properties, public fields, collection element
/// types and public nested types are all followed, each type is expanded at most once, and BCL types
/// are treated as leaves (their generic arguments are still followed) so the walk stops at the
/// framework boundary rather than exploring it. Every finding names the declaring type and the
/// member, so a failure points at the offending declaration rather than at the root.
/// </para>
/// </summary>
public static class ResolvingIdentifierScan
{
    /// <summary>What a member was classified as.</summary>
    public enum DisclosureKind
    {
        /// <summary>A provider subject — the value that resolves an external account.</summary>
        ProviderSubject,

        /// <summary>A password credential or its stored hash.</summary>
        PasswordCredential,

        /// <summary>Token material — a refresh/access token, a secret, or a stored token hash.</summary>
        TokenMaterial,

        /// <summary>
        /// An identity id. Deliberately carried by <c>AccountView</c> (it is what unlinking accepts)
        /// and deliberately absent from <c>UserDataExport</c>, so it is classified rather than
        /// condemned.
        /// </summary>
        IdentityId,
    }

    /// <summary>
    /// Member-name fragments, most specific first. A match classifies the member by the kind beside
    /// the fragment.
    /// </summary>
    private static readonly (string Fragment, DisclosureKind Kind)[] MemberNameFragments =
    [
        ("ProviderUserId", DisclosureKind.ProviderSubject),
        ("ProviderSubject", DisclosureKind.ProviderSubject),
        ("Subject", DisclosureKind.ProviderSubject),
        ("PasswordCredential", DisclosureKind.PasswordCredential),
        ("PasswordHash", DisclosureKind.PasswordCredential),
        ("Password", DisclosureKind.PasswordCredential),
        ("Credential", DisclosureKind.PasswordCredential),
        ("RefreshToken", DisclosureKind.TokenMaterial),
        ("AccessToken", DisclosureKind.TokenMaterial),
        ("TokenHash", DisclosureKind.TokenMaterial),
        ("Token", DisclosureKind.TokenMaterial),
        ("Secret", DisclosureKind.TokenMaterial),
        ("Hash", DisclosureKind.TokenMaterial),
    ];

    /// <summary>
    /// The same vocabulary applied to a member's carried type names, so a benignly named member
    /// whose type carries the material is caught.
    /// </summary>
    private static readonly (string Fragment, DisclosureKind Kind)[] CarriedTypeNameFragments =
    [
        ("PasswordCredential", DisclosureKind.PasswordCredential),
        ("Credential", DisclosureKind.PasswordCredential),
        ("Password", DisclosureKind.PasswordCredential),
        ("RefreshToken", DisclosureKind.TokenMaterial),
        ("Token", DisclosureKind.TokenMaterial),
        ("Secret", DisclosureKind.TokenMaterial),
        ("Hash", DisclosureKind.TokenMaterial),
    ];

    /// <summary>One member found on one type during the walk.</summary>
    /// <param name="DeclaringType">The type the member is declared on (or inherited onto).</param>
    /// <param name="Name">The member's name.</param>
    /// <param name="MemberType">The member's declared type.</param>
    public sealed record ScannedMember(Type DeclaringType, string Name, Type MemberType)
    {
        /// <summary>Names the offending declaration: <c>Type.Member : MemberType</c>.</summary>
        public override string ToString() => $"{DeclaringType.Name}.{Name} : {Describe(MemberType)}";
    }

    /// <summary>A classified member: the member, and what it was classified as.</summary>
    /// <param name="Member">The member found during the walk.</param>
    /// <param name="Kind">What the member was classified as.</param>
    public sealed record Finding(ScannedMember Member, DisclosureKind Kind)
    {
        /// <summary>Names the finding and the declaration it sits on.</summary>
        public override string ToString() => $"{Member} — {Kind}";
    }

    /// <summary>
    /// The result of one walk: every type reached from the root, every member found on those types,
    /// and the classified subset.
    /// </summary>
    public sealed class Graph
    {
        internal Graph(
            Type root,
            IReadOnlyList<Type> types,
            IReadOnlyList<ScannedMember> members,
            IReadOnlyList<Finding> findings)
        {
            Root = root;
            Types = types;
            Members = members;
            Findings = findings;
            Disclosures = [.. findings.Where(finding => finding.Kind != DisclosureKind.IdentityId)];
            IdentityIds = [.. findings.Where(finding => finding.Kind == DisclosureKind.IdentityId)];
        }

        /// <summary>The read-model root the walk started from.</summary>
        public Type Root { get; }

        /// <summary>Every type reached transitively from <see cref="Root"/>, including leaves.</summary>
        public IReadOnlyList<Type> Types { get; }

        /// <summary>Every member found on the expanded (non-leaf) types of the graph.</summary>
        public IReadOnlyList<ScannedMember> Members { get; }

        /// <summary>Every classified member, of any kind.</summary>
        public IReadOnlyList<Finding> Findings { get; }

        /// <summary>
        /// The resolving identifiers — provider subjects, password credentials and token material.
        /// This list being empty is the non-disclosure property (Requirement 8.7, 9.2).
        /// </summary>
        public IReadOnlyList<Finding> Disclosures { get; }

        /// <summary>The identity-id members found in this graph.</summary>
        public IReadOnlyList<Finding> IdentityIds { get; }

        /// <summary>Whether <paramref name="type"/> carries an identity id in this graph.</summary>
        /// <param name="type">The type to test.</param>
        /// <returns><see langword="true"/> when a member of that type is an identity id.</returns>
        public bool CarriesIdentityId(Type type) =>
            IdentityIds.Any(finding => finding.Member.DeclaringType == type);
    }

    /// <summary>
    /// Walks the transitive type graph reachable from <paramref name="root"/>, classifying every
    /// member it finds.
    /// </summary>
    /// <param name="root">The read-model root to walk from.</param>
    /// <returns>The walked <see cref="Graph"/>.</returns>
    public static Graph Walk(Type root)
    {
        ArgumentNullException.ThrowIfNull(root);

        var visited = new HashSet<Type>();
        var queue = new Queue<Type>();
        var types = new List<Type>();
        var members = new List<ScannedMember>();
        var findings = new List<Finding>();

        Enqueue(root);

        while (queue.Count > 0)
        {
            Type current = queue.Dequeue();
            types.Add(current);

            // Leaves are recorded as reached but never expanded: their generic arguments were
            // already enqueued by the member that carried them.
            if (IsLeaf(current))
            {
                continue;
            }

            foreach (ScannedMember member in MembersOf(current))
            {
                members.Add(member);

                if (Classify(member) is DisclosureKind kind)
                {
                    findings.Add(new Finding(member, kind));
                }

                foreach (Type carried in CarriedTypes(member.MemberType))
                {
                    Enqueue(carried);
                }
            }

            foreach (Type nested in current.GetNestedTypes(BindingFlags.Public))
            {
                Enqueue(nested);
            }
        }

        return new Graph(root, types, members, findings);

        // The cycle guard: a type is enqueued, and therefore expanded, at most once.
        void Enqueue(Type type)
        {
            if (visited.Add(type))
            {
                queue.Enqueue(type);
            }
        }
    }

    /// <summary>
    /// Classifies one member by its name and by its carried types, returning <see langword="null"/>
    /// when the member carries nothing resolving.
    /// </summary>
    /// <param name="member">The member to classify.</param>
    /// <returns>The classification, or <see langword="null"/> when the member is benign.</returns>
    public static DisclosureKind? Classify(ScannedMember member)
    {
        ArgumentNullException.ThrowIfNull(member);

        // An identity id is classified first and never falls through to the disclosure vocabulary:
        // AccountView is meant to carry it, UserDataExport is meant not to.
        if (member.Name.EndsWith("IdentityId", StringComparison.OrdinalIgnoreCase))
        {
            return DisclosureKind.IdentityId;
        }

        foreach ((string fragment, DisclosureKind kind) in MemberNameFragments)
        {
            if (member.Name.Contains(fragment, StringComparison.OrdinalIgnoreCase))
            {
                return kind;
            }
        }

        foreach (Type carried in CarriedTypes(member.MemberType))
        {
            foreach ((string fragment, DisclosureKind kind) in CarriedTypeNameFragments)
            {
                if (carried.Name.Contains(fragment, StringComparison.OrdinalIgnoreCase))
                {
                    return kind;
                }
            }
        }

        return null;
    }

    /// <summary>Renders findings as a numbered, one-per-line failure message.</summary>
    /// <param name="findings">The findings to render.</param>
    /// <returns>A human-readable list naming each offending type and member.</returns>
    public static string Report(IEnumerable<Finding> findings)
    {
        ArgumentNullException.ThrowIfNull(findings);

        return string.Join(Environment.NewLine, findings.Select(finding => $"  - {finding}"));
    }

    /// <summary>
    /// The public instance properties (excluding indexers) and public instance fields of a type,
    /// including inherited ones so a base class cannot hide a disclosing member.
    /// </summary>
    private static IEnumerable<ScannedMember> MembersOf(Type type)
    {
        const BindingFlags Flags = BindingFlags.Public | BindingFlags.Instance;

        foreach (PropertyInfo property in type.GetProperties(Flags))
        {
            if (property.GetIndexParameters().Length > 0)
            {
                continue;
            }

            yield return new ScannedMember(type, property.Name, property.PropertyType);
        }

        foreach (FieldInfo field in type.GetFields(Flags))
        {
            yield return new ScannedMember(type, field.Name, field.FieldType);
        }
    }

    /// <summary>
    /// The types a member type carries: itself, an array's element type, a nullable's underlying
    /// type, and every generic type argument — transitively, so
    /// <c>IReadOnlyList&lt;IReadOnlyList&lt;T&gt;&gt;</c> reaches <c>T</c>.
    /// </summary>
    private static IReadOnlyList<Type> CarriedTypes(Type type)
    {
        var seen = new HashSet<Type>();
        var carried = new List<Type>();

        Visit(type);
        return carried;

        void Visit(Type candidate)
        {
            if (!seen.Add(candidate))
            {
                return;
            }

            carried.Add(candidate);

            if (candidate.HasElementType && candidate.GetElementType() is Type element)
            {
                Visit(element);
            }

            if (candidate.IsGenericType)
            {
                foreach (Type argument in candidate.GetGenericArguments())
                {
                    Visit(argument);
                }
            }
        }
    }

    /// <summary>
    /// Whether a type is a leaf — a primitive, an enum, or any BCL type. BCL types are leaves so the
    /// walk stops at the framework boundary; the generic arguments of a collection interface were
    /// already followed by <see cref="CarriedTypes"/>.
    /// </summary>
    private static bool IsLeaf(Type type) =>
        type.IsEnum
        || type.IsPrimitive
        || type == typeof(string)
        || type == typeof(object)
        || type.Namespace is null
        || type.Namespace == "System"
        || type.Namespace.StartsWith("System.", StringComparison.Ordinal);

    /// <summary>Renders a type name, expanding generic arguments so a collection reads clearly.</summary>
    private static string Describe(Type type)
    {
        if (!type.IsGenericType)
        {
            return type.Name;
        }

        string name = type.Name;
        int tick = name.IndexOf('`', StringComparison.Ordinal);
        if (tick >= 0)
        {
            name = name[..tick];
        }

        return $"{name}<{string.Join(", ", type.GetGenericArguments().Select(Describe))}>";
    }
}
