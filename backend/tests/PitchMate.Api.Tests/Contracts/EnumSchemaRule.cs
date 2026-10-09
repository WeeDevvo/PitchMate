using System.Text.Json;

namespace PitchMate.Api.Tests.Contracts;

/// <summary>
/// Reads the enumerating schemas out of an emitted OpenAPI document and applies Requirement 4.4's
/// rule to them: every wire enum reachable from a response contract or a request body is a
/// <b>named</b> schema whose enumerated values are that enum's member names, and none of them
/// describes its values as integers.
/// <para>
/// <b>Reachability is resolved from the document, not declared here.</b> The walk starts at every
/// declared response content schema and every request body content schema, follows
/// <c>$ref</c>s transitively through <c>components/schemas</c>, and collects the enumerating schemas
/// it finds on the way. Nothing names the reachable enums, so an enum that becomes reachable later —
/// the moment some endpoint declares a contract carrying it — enters the rule unedited, and one that
/// is only ever reachable from a parameter or from nothing at all is not asserted about here. The
/// <i>serialiser-level</i> vocabulary of every wire enum, reachable or not, is Property 6's subject.
/// </para>
/// <para>
/// <b>What "string schema" means against this exporter.</b> Requirement 13.7 words the expectation as
/// a "named string schema", but .NET 10's <c>JsonSchemaExporter</c> describes a by-name enum solely by
/// its enumerated values and emits no <c>type</c> keyword:
/// <c>{"enum":["Owner","Admin","Member"]}</c>. Demanding the literal keyword would assert a fact about
/// the exporter rather than about the contract, and would fail on a document that is entirely correct.
/// The rule therefore enforces the substance: the enumerated values are JSON strings equal to the
/// member names, and the schema is never an integer or numeric one. A regression to
/// <c>{"type":"integer"}</c> is caught by that, and by the non-vacuity floor above the rule — an
/// integer-serialised enum does not reach the document as a named schema at all, so the reachable
/// count collapses.
/// </para>
/// <para>
/// <b>Why <c>null</c> is tolerated among the values.</b> The exporter folds reference-site nullability
/// into the single shared named schema, so a nullable member such as <c>SquadMemberView.Role</c> makes
/// <c>SquadRole</c> itself enumerate <c>null</c>. The document keeps no record of which reference site
/// asked for it, so a rule reading the document cannot require the nullability to be justified per
/// site. <c>null</c> is JSON's absence marker rather than a member of the enum's vocabulary, and it is
/// excluded from the vocabulary comparison for that reason.
/// </para>
/// <para>
/// The rule is stated over the document's JSON rather than over the <c>OpenApiDocument</c> object
/// model, for the same two reasons <see cref="ProblemSchemaRule"/> gives: the JSON is what a client
/// generator consumes, and the object model's shape has moved between <c>Microsoft.OpenApi</c> majors.
/// The document is supplied by the caller, so the same rule can be applied to a synthesised document
/// in a control — without which it could be satisfied by finding nothing at all.
/// </para>
/// </summary>
public static class EnumSchemaRule
{
    /// <summary>The components prefix a schema reference resolves against.</summary>
    public const string SchemaReferencePrefix = "#/components/schemas/";

    /// <summary>The <c>type</c> keyword tokens an enum schema of a string vocabulary may carry.</summary>
    private static readonly string[] PermittedTypeTokens = ["string", "null"];

    /// <summary>The <c>type</c> keyword tokens that make a schema an integer or numeric one.</summary>
    private static readonly string[] NumericTypeTokens = ["integer", "number"];

    // The operation keys of an OpenAPI path item. A path item also carries non-operation members
    // (`parameters`, `summary`, `$ref`), so the operations cannot simply be "every member".
    private static readonly string[] OperationKeys =
        ["get", "put", "post", "delete", "options", "head", "patch", "trace"];

    /// <summary>
    /// Every enumerating schema reachable from a declared response contract or a request body, named
    /// or inlined, in the order the walk meets them.
    /// </summary>
    /// <param name="document">The emitted document's root element.</param>
    /// <returns>One fact per enumerating schema found on the reachable surface.</returns>
    public static IReadOnlyList<EnumSchemaFact> EnumSchemasOf(JsonElement document)
    {
        IReadOnlyDictionary<string, JsonElement> schemas = ComponentSchemasOf(document);
        var facts = new List<EnumSchemaFact>();
        var reached = new HashSet<string>(StringComparer.Ordinal);
        var pending = new Queue<string>();

        foreach ((string origin, JsonElement content) in ContractRootsOf(document))
        {
            // A contract may enumerate inline instead of referencing a named schema. That is an
            // offence rather than something to skip, so the root subtree is collected too.
            Collect(content, origin, schemaName: null, facts);
            Enqueue(content, reached, pending);
        }

        while (pending.Count > 0)
        {
            string name = pending.Dequeue();

            if (!schemas.TryGetValue(name, out JsonElement schema))
            {
                // A dangling reference is the document's own problem and is reported by the schema
                // consistency guards; there is no enumeration here to judge.
                continue;
            }

            Collect(schema, $"components/schemas/{name}", name, facts);
            Enqueue(schema, reached, pending);
        }

        return facts;
    }

    /// <summary>
    /// Applies the rule and returns one message per offence, each naming the offending schema, where
    /// it sits, and the fact at fault.
    /// </summary>
    /// <param name="facts">The enumerating schemas to check.</param>
    /// <param name="clrEnumsByName">
    /// The candidate CLR enums, keyed by type name — the set a schema name is matched against to find
    /// the vocabulary the schema is supposed to be enumerating.
    /// </param>
    /// <returns>Every offence found, de-duplicated and in discovery order.</returns>
    public static IReadOnlyList<string> Offences(
        IEnumerable<EnumSchemaFact> facts, IReadOnlyDictionary<string, Type> clrEnumsByName)
    {
        ArgumentNullException.ThrowIfNull(facts);
        ArgumentNullException.ThrowIfNull(clrEnumsByName);

        var offences = new List<string>();

        foreach (EnumSchemaFact fact in facts)
        {
            offences.AddRange(OffencesOf(fact, clrEnumsByName));
        }

        return [.. offences.Distinct(StringComparer.Ordinal)];
    }

    /// <summary>
    /// The CLR enums the document turns out to be reachable from a contract — each paired, by name,
    /// with the named schema that describes it. Used for the non-vacuity floor and to drive the
    /// property over exactly the population the rule ranges over.
    /// </summary>
    /// <param name="facts">The enumerating schemas found on the reachable surface.</param>
    /// <param name="clrEnumsByName">The candidate CLR enums, keyed by type name.</param>
    /// <returns>The matched schema name to CLR enum pairs, ordered by name.</returns>
    public static IReadOnlyDictionary<string, Type> MatchedEnums(
        IEnumerable<EnumSchemaFact> facts, IReadOnlyDictionary<string, Type> clrEnumsByName)
    {
        ArgumentNullException.ThrowIfNull(facts);
        ArgumentNullException.ThrowIfNull(clrEnumsByName);

        var matched = new SortedDictionary<string, Type>(StringComparer.Ordinal);

        foreach (EnumSchemaFact fact in facts)
        {
            if (fact.SchemaName is { } name && clrEnumsByName.TryGetValue(name, out Type? clrEnum))
            {
                matched[name] = clrEnum;
            }
        }

        return matched;
    }

    private static IEnumerable<string> OffencesOf(
        EnumSchemaFact fact, IReadOnlyDictionary<string, Type> clrEnumsByName)
    {
        if (fact.SchemaName is null)
        {
            yield return
                $"{fact.Description} enumerates {fact.ValueCount} value(s) inline instead of being a "
                    + "named component schema, so the generated client would carry an anonymous union "
                    + $"for this one contract rather than the shared enum type: {fact.RawText}";

            yield break;
        }

        if (!clrEnumsByName.TryGetValue(fact.SchemaName, out Type? clrEnum))
        {
            yield return
                $"{fact.Description} matches no public enum of the Domain or Application assemblies, "
                    + "so the vocabulary it publishes is unchecked. Either the schema is named after "
                    + "something other than its CLR enum, or the enum has moved out of the two "
                    + $"assemblies the candidates are discovered from: {fact.RawText}";

            yield break;
        }

        foreach (string offence in TypeOffencesOf(fact))
        {
            yield return offence;
        }

        foreach (string offence in VocabularyOffencesOf(fact, clrEnum))
        {
            yield return offence;
        }
    }

    private static IEnumerable<string> TypeOffencesOf(EnumSchemaFact fact)
    {
        string[] tokens = fact.TypeKeyword?.Split('|') ?? [];

        if (tokens.Intersect(NumericTypeTokens, StringComparer.Ordinal).Any())
        {
            yield return
                $"{fact.Description} describes its values as '{fact.TypeKeyword}', so this wire enum "
                    + $"appears in the document as an integer schema: {fact.RawText}";
        }
        else if (tokens.Except(PermittedTypeTokens, StringComparer.Ordinal).Any())
        {
            yield return
                $"{fact.Description} carries the type keyword '{fact.TypeKeyword}', which is neither "
                    + $"absent nor a string vocabulary: {fact.RawText}";
        }

        if (fact.OtherValues.Count > 0)
        {
            yield return
                $"{fact.Description} enumerates {fact.OtherValues.Count} value(s) that are not JSON "
                    + $"strings ({string.Join(", ", fact.OtherValues)}), so a client would be told to "
                    + $"send something other than the member name: {fact.RawText}";
        }
    }

    private static IEnumerable<string> VocabularyOffencesOf(EnumSchemaFact fact, Type clrEnum)
    {
        string[] memberNames = Enum.GetNames(clrEnum);

        string[] missing =
            [.. memberNames.Except(fact.StringValues, StringComparer.Ordinal).Order(StringComparer.Ordinal)];

        string[] unexpected =
            [.. fact.StringValues.Except(memberNames, StringComparer.Ordinal).Order(StringComparer.Ordinal)];

        string[] duplicated =
        [
            .. fact.StringValues
                .GroupBy(static value => value, StringComparer.Ordinal)
                .Where(static group => group.Count() > 1)
                .Select(static group => group.Key)
                .Order(StringComparer.Ordinal),
        ];

        if (missing.Length > 0)
        {
            yield return
                $"{fact.Description} does not enumerate {missing.Length} member name(s) of "
                    + $"{clrEnum.Name} ({string.Join(", ", missing)}), so a value the Api serialises "
                    + $"is absent from the contract: {fact.RawText}";
        }

        if (unexpected.Length > 0)
        {
            yield return
                $"{fact.Description} enumerates {unexpected.Length} value(s) that are not member "
                    + $"names of {clrEnum.Name} ({string.Join(", ", unexpected)}), so the contract "
                    + $"publishes a vocabulary the Api cannot read back: {fact.RawText}";
        }

        if (duplicated.Length > 0)
        {
            yield return
                $"{fact.Description} enumerates {duplicated.Length} member name(s) more than once "
                    + $"({string.Join(", ", duplicated)}): {fact.RawText}";
        }
    }

    private static IReadOnlyDictionary<string, JsonElement> ComponentSchemasOf(JsonElement document)
    {
        var schemas = new Dictionary<string, JsonElement>(StringComparer.Ordinal);

        if (!document.TryGetProperty("components", out JsonElement components)
            || components.ValueKind != JsonValueKind.Object
            || !components.TryGetProperty("schemas", out JsonElement declared)
            || declared.ValueKind != JsonValueKind.Object)
        {
            return schemas;
        }

        foreach (JsonProperty schema in declared.EnumerateObject())
        {
            schemas[schema.Name] = schema.Value;
        }

        return schemas;
    }

    /// <summary>
    /// The walk's starting points: every declared response content schema and every request body
    /// content schema of every operation. Parameters are deliberately not roots — Requirement 4.4 is
    /// about response contracts and request bodies, and the leaderboard <c>statistic</c> parameter has
    /// its own guard in Property 9.
    /// </summary>
    private static IEnumerable<(string Origin, JsonElement Content)> ContractRootsOf(JsonElement document)
    {
        if (!document.TryGetProperty("paths", out JsonElement paths)
            || paths.ValueKind != JsonValueKind.Object)
        {
            yield break;
        }

        foreach (JsonProperty path in paths.EnumerateObject())
        {
            if (path.Value.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            foreach (JsonProperty operation in path.Value.EnumerateObject())
            {
                if (!OperationKeys.Contains(operation.Name, StringComparer.OrdinalIgnoreCase)
                    || operation.Value.ValueKind != JsonValueKind.Object)
                {
                    continue;
                }

                string method = operation.Name.ToUpperInvariant();

                if (operation.Value.TryGetProperty("requestBody", out JsonElement requestBody)
                    && requestBody.TryGetProperty("content", out JsonElement requestContent))
                {
                    yield return ($"{method} {path.Name} (request body)", requestContent);
                }

                if (!operation.Value.TryGetProperty("responses", out JsonElement responses)
                    || responses.ValueKind != JsonValueKind.Object)
                {
                    continue;
                }

                foreach (JsonProperty response in responses.EnumerateObject())
                {
                    if (response.Value.ValueKind == JsonValueKind.Object
                        && response.Value.TryGetProperty("content", out JsonElement responseContent))
                    {
                        yield return ($"{method} {path.Name} ({response.Name})", responseContent);
                    }
                }
            }
        }
    }

    private static void Enqueue(JsonElement element, HashSet<string> reached, Queue<string> pending)
    {
        foreach (string name in ReferencesIn(element))
        {
            if (reached.Add(name))
            {
                pending.Enqueue(name);
            }
        }
    }

    private static IEnumerable<string> ReferencesIn(JsonElement element)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                foreach (JsonProperty member in element.EnumerateObject())
                {
                    if (string.Equals(member.Name, "$ref", StringComparison.Ordinal)
                        && member.Value.ValueKind == JsonValueKind.String
                        && member.Value.GetString() is { } reference
                        && reference.StartsWith(SchemaReferencePrefix, StringComparison.Ordinal))
                    {
                        yield return reference[SchemaReferencePrefix.Length..];

                        continue;
                    }

                    foreach (string nested in ReferencesIn(member.Value))
                    {
                        yield return nested;
                    }
                }

                break;

            case JsonValueKind.Array:
                foreach (JsonElement item in element.EnumerateArray())
                {
                    foreach (string nested in ReferencesIn(item))
                    {
                        yield return nested;
                    }
                }

                break;

            default:
                break;
        }
    }

    /// <summary>
    /// Collects the enumerating schemas within <paramref name="element"/>. The subtree is walked, not
    /// just its root, so an enumeration buried in an array's <c>items</c> or behind a composition
    /// keyword is found; only the subtree's own root is credited with
    /// <paramref name="schemaName"/>, because anything deeper is not a named schema.
    /// </summary>
    private static void Collect(
        JsonElement element, string origin, string? schemaName, List<EnumSchemaFact> facts)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                if (element.TryGetProperty("enum", out JsonElement values)
                    && values.ValueKind == JsonValueKind.Array)
                {
                    facts.Add(FactFor(element, values, origin, schemaName));
                }

                foreach (JsonProperty member in element.EnumerateObject())
                {
                    Collect(member.Value, $"{origin}/{member.Name}", schemaName: null, facts);
                }

                break;

            case JsonValueKind.Array:
                int index = 0;

                foreach (JsonElement item in element.EnumerateArray())
                {
                    Collect(item, $"{origin}/{index++}", schemaName: null, facts);
                }

                break;

            default:
                break;
        }
    }

    private static EnumSchemaFact FactFor(
        JsonElement schema, JsonElement values, string origin, string? schemaName)
    {
        var strings = new List<string>();
        var others = new List<string>();
        bool allowsNull = false;

        foreach (JsonElement value in values.EnumerateArray())
        {
            switch (value.ValueKind)
            {
                case JsonValueKind.String:
                    strings.Add(value.GetString()!);

                    break;

                case JsonValueKind.Null:
                    allowsNull = true;

                    break;

                default:
                    others.Add(value.GetRawText());

                    break;
            }
        }

        return new EnumSchemaFact(
            origin, schemaName, TypeKeywordOf(schema), strings, allowsNull, others, schema.GetRawText());
    }

    private static string? TypeKeywordOf(JsonElement schema)
    {
        if (!schema.TryGetProperty("type", out JsonElement type))
        {
            return null;
        }

        return type.ValueKind switch
        {
            JsonValueKind.String => type.GetString(),
            JsonValueKind.Array => string.Join(
                '|',
                type.EnumerateArray()
                    .Select(static token => token.ValueKind == JsonValueKind.String
                        ? token.GetString()
                        : token.GetRawText())),
            _ => type.GetRawText(),
        };
    }
}
