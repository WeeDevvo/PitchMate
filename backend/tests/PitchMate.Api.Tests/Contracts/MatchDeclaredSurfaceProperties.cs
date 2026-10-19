using System.Text.Json;
using System.Text.RegularExpressions;
using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;

namespace PitchMate.Api.Tests.Contracts;

/// <summary>
/// The guard for <b>Property 26 — The declared surface is the mapped surface</b> (match-read-models
/// task 8.2).
/// <para>
/// <b>Validates: Requirements 12.1, 12.2, 12.5</b>
/// </para>
/// <para>
/// Three claims, all over discovered sets rather than listed ones, so the guard holds unedited as the
/// detail and working-teams reads land:
/// </para>
/// <list type="bullet">
///   <item><description>each of the chore's reads (<see cref="MatchReadContracts.Contracts"/>) declares
///   exactly one success status, with exactly one response contract type for it;</description></item>
///   <item><description>each of those contracts, and every contract reachable from them, is emitted as a
///   uniquely named component schema and referenced — never inlined — at the operation's success
///   response;</description></item>
///   <item><description>the set of match operations the emitted document declares equals the set of
///   match endpoints the host maps, method and route alike.</description></item>
/// </list>
/// </summary>
public sealed partial class MatchDeclaredSurfaceProperties
    : IClassFixture<EmittedDocumentCatalogue>, IClassFixture<MappedEndpointCatalogue>
{
    private const string SchemaRefPrefix = "#/components/schemas/";

    private static readonly string[] HttpMethodNames = ["get", "put", "post", "delete", "patch"];

    private readonly JsonElement _document;
    private readonly IReadOnlyList<MappedEndpoint> _matchEndpoints;
    private readonly IReadOnlyList<MappedEndpoint> _reads;

    /// <summary>Receives the emitted document and the endpoints the host maps.</summary>
    public MatchDeclaredSurfaceProperties(EmittedDocumentCatalogue document, MappedEndpointCatalogue endpoints)
    {
        ArgumentNullException.ThrowIfNull(document);
        ArgumentNullException.ThrowIfNull(endpoints);

        _document = document.Document;
        _matchEndpoints = [.. endpoints.Endpoints.Where(static endpoint => IsMatchRoute(Normalise(endpoint.Route)))];
        _reads =
        [
            .. endpoints.Endpoints.Where(static endpoint => endpoint.DeclaredSuccessResponses.Any(static response =>
                response.BodyType is { } body && MatchReadContracts.Contracts.Contains(body))),
        ];
    }

    /// <summary>
    /// Each chore read declares exactly one success status carrying exactly one response contract type.
    /// </summary>
    [Fact]
    public void EachReadDeclaresExactlyOneSuccessContract()
    {
        Assert.NotEmpty(_reads);

        foreach (MappedEndpoint read in _reads)
        {
            DeclaredResponse success = Assert.Single(read.DeclaredSuccessResponses);
            Assert.NotNull(success.BodyType);
        }
    }

    /// <summary>
    /// Every chore read's success response references a component schema rather than inlining one,
    /// and every contract reachable from the reads is emitted under its own, unique schema name.
    /// </summary>
    [Fact]
    public void EveryReadContractIsAUniquelyNamedReferencedSchema()
    {
        var offences = new List<string>();

        foreach (MappedEndpoint read in _reads)
        {
            JsonElement operation = OperationOf(_document, read);
            offences.AddRange(SuccessSchemaOffences(read.Description, operation));
        }

        JsonElement schemas = _document.GetProperty("components").GetProperty("schemas");

        foreach (IGrouping<string, Type> sameName in MatchReadContracts.ReachableContracts.GroupBy(static type => type.Name))
        {
            if (sameName.Count() > 1)
            {
                offences.Add($"schema name '{sameName.Key}' is shared by {string.Join(", ", sameName.Select(static type => type.FullName))}");
            }

            if (!schemas.TryGetProperty(sameName.Key, out _))
            {
                offences.Add($"contract '{sameName.Key}' is not emitted as a component schema");
            }
        }

        Assert.True(offences.Count == 0, string.Join(Environment.NewLine, offences));
    }

    /// <summary>
    /// The exhaustive comparison: the match operations the document declares are exactly the match
    /// endpoints the host maps. The count is derived from both sides, never hardcoded.
    /// </summary>
    [Fact]
    public void TheDocumentsMatchOperationsAreTheHostsMatchEndpoints()
    {
        HashSet<string> mapped = [.. _matchEndpoints.SelectMany(static endpoint =>
            endpoint.Method.Split('+').Select(method => Key(method, endpoint.Route)))];

        HashSet<string> declared = [.. DeclaredMatchOperations(_document)];

        Assert.NotEmpty(mapped);
        Assert.Equal(mapped.Order(StringComparer.Ordinal), declared.Order(StringComparer.Ordinal));
        Assert.Contains(Key("GET", "/squads/{squadId}/matches"), declared);
    }

    // Feature: match-read-models, Property 26: The declared surface is the mapped surface — the
    // operation rule classifies synthesised success responses.
    /// <summary>
    /// **Validates: Requirements 12.1, 12.2** — over synthesised operation shapes, the rule accepts an
    /// operation iff it declares exactly one success status whose JSON schema is a component reference,
    /// and reports inline schemas, missing bodies and additional success statuses.
    /// </summary>
    [Property(MaxTest = 100)]
    public Property TheOperationRuleClassifiesSynthesisedShapes() =>
        Prop.ForAll(
            Arb.From(
                from successCount in Gen.Choose(0, 2)
                from referenced in ArbMap.Default.GeneratorFor<bool>()
                from hasBody in ArbMap.Default.GeneratorFor<bool>()
                select (SuccessCount: successCount, Referenced: referenced, HasBody: hasBody)),
            shape =>
            {
                string body = !shape.HasBody
                    ? "{}"
                    : shape.Referenced
                        ? """{ "content": { "application/json": { "schema": { "$ref": "#/components/schemas/MatchList" } } } }"""
                        : """{ "content": { "application/json": { "schema": { "type": "object" } } } }""";

                string successes = string.Join(", ", Enumerable.Range(0, shape.SuccessCount)
                    .Select(i => $"\"{200 + i}\": {body}"));
                string responses = string.Join(", ", new[] { successes, "\"404\": {}" }.Where(static part => part.Length > 0));

                using JsonDocument operation = JsonDocument.Parse($$"""{ "responses": { {{responses}} } }""");

                bool conforms = shape.SuccessCount == 1 && shape.HasBody && shape.Referenced;
                IReadOnlyList<string> offences = SuccessSchemaOffences("GET /synthesised", operation.RootElement);

                return (conforms == (offences.Count == 0))
                    .ToProperty()
                    .Label($"{shape} -> {string.Join("; ", offences)}")
                    .Collect(conforms ? "conforming" : "offending");
            });

    /// <summary>
    /// The planted-violation control for the surface comparison: a document missing one mapped
    /// operation, or declaring one the host does not map, differs from the mapped set.
    /// </summary>
    [Fact]
    public void TheSurfaceComparisonDetectsAMissingOrExtraOperation()
    {
        using JsonDocument synthesised = JsonDocument.Parse(
            """
            { "paths": {
              "/squads/{squadId}/matches": { "get": {} },
              "/matches/{matchId}/phantom": { "post": {} }
            } }
            """);

        HashSet<string> declared = [.. DeclaredMatchOperations(synthesised.RootElement)];

        Assert.Contains(Key("POST", "/matches/{matchId}/phantom"), declared);
        Assert.DoesNotContain(Key("POST", "/matches/{matchId}/start"), declared);
        Assert.Contains(_matchEndpoints, static endpoint => Normalise(endpoint.Route) == "/matches/{matchId}/start");
    }

    /// <summary>One offence per way an operation's success response falls short of one referenced contract.</summary>
    private static IReadOnlyList<string> SuccessSchemaOffences(string at, JsonElement operation)
    {
        List<JsonProperty> successes =
        [
            .. operation.GetProperty("responses").EnumerateObject()
                .Where(static response => response.Name.Length == 3 && response.Name[0] == '2'),
        ];

        if (successes.Count != 1)
        {
            return [$"{at} declares {successes.Count} success statuses, not one"];
        }

        if (!successes[0].Value.TryGetProperty("content", out JsonElement content)
            || !content.TryGetProperty("application/json", out JsonElement json)
            || !json.TryGetProperty("schema", out JsonElement schema))
        {
            return [$"{at} declares no response contract for {successes[0].Name}"];
        }

        return schema.TryGetProperty("$ref", out JsonElement reference)
            && reference.GetString()?.StartsWith(SchemaRefPrefix, StringComparison.Ordinal) == true
                ? []
                : [$"{at} inlines its {successes[0].Name} schema instead of referencing a component: {schema.GetRawText()}"];
    }

    /// <summary>The document's match operations, as normalised <c>METHOD route</c> keys.</summary>
    private static IEnumerable<string> DeclaredMatchOperations(JsonElement document) =>
        document.GetProperty("paths").EnumerateObject()
            .Where(static path => IsMatchRoute(Normalise(path.Name)))
            .SelectMany(static path => path.Value.EnumerateObject()
                .Where(static operation => HttpMethodNames.Contains(operation.Name))
                .Select(operation => Key(operation.Name, path.Name)));

    /// <summary>The document operation for a mapped endpoint.</summary>
    private static JsonElement OperationOf(JsonElement document, MappedEndpoint endpoint)
    {
        string route = Normalise(endpoint.Route);
        string method = endpoint.Method.Split('+')[0].ToLowerInvariant();

        return document.GetProperty("paths").EnumerateObject()
            .Single(path => Normalise(path.Name) == route)
            .Value.GetProperty(method);
    }

    private static bool IsMatchRoute(string route) =>
        route.StartsWith("/matches", StringComparison.Ordinal)
        || route.StartsWith("/squads/{squadId}/matches", StringComparison.Ordinal);

    private static string Key(string method, string route) => $"{method.ToUpperInvariant()} {Normalise(route)}";

    /// <summary>Drops route constraints and a trailing slash, so mapped and declared routes compare.</summary>
    private static string Normalise(string route)
    {
        string unconstrained = RouteConstraint().Replace(route, "{$1}");
        return unconstrained.Length > 1 ? unconstrained.TrimEnd('/') : unconstrained;
    }

    [GeneratedRegex(@"\{([^}:]+):[^}]+\}")]
    private static partial Regex RouteConstraint();
}
