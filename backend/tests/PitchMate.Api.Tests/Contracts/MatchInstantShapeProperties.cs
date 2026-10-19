using System.Reflection;
using System.Text.Json;
using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using PitchMate.Api.Tests.Auth;
using PitchMate.Domain.Matches;
using HttpJsonOptions = Microsoft.AspNetCore.Http.Json.JsonOptions;

namespace PitchMate.Api.Tests.Contracts;

/// <summary>
/// The guard for <b>Property 21 — One shape for an instant, one vocabulary for a state</b>
/// (match-read-models task 7.7), over the document read from the running host.
/// <para>
/// <b>Validates: Requirements 9.1, 9.2, 9.4, 9.5, 9.6, 9.7, 9.8, 9.10, 9.11</b>
/// </para>
/// <para>
/// <b>Instants.</b> Every instant-valued member reachable from a match response contract is a
/// <c>date-time</c> string schema (or an array of them). The members are found from the CLR side — every
/// <see cref="DateTimeOffset"/> property reachable from the success body of a mapped match endpoint — and
/// then looked up in the document, so a member emitted without its <c>date-time</c> format cannot escape
/// by not being recognised as an instant.
/// </para>
/// <para>
/// <b>No wrapper.</b> No candidate-day wrapper schema — a schema named <c>CandidateDay</c>, or an object
/// whose only member is <c>instant</c> — is reachable from any match operation. A <c>Wire_Instant</c>
/// emitted for a candidate day parses back to a candidate day equal by instant, whatever offset it was
/// created from.
/// </para>
/// <para>
/// <b>Vocabulary.</b> <see cref="MatchState"/> crosses the wire by member name through the one
/// registered by-name JSON configuration; its document schema is pinned in
/// <see cref="WireEnumSchemaProperties.MatchStateIsPublishedAsExactlyItsSixMemberNames"/>.
/// </para>
/// </summary>
public sealed class MatchInstantShapeProperties
    : IClassFixture<EmittedDocumentCatalogue>, IClassFixture<MappedEndpointCatalogue>, IClassFixture<AuthApiFactory>
{
    /// <summary>The non-vacuity floor on instant-valued members reachable from match contracts.</summary>
    private const int MinimumInstantMemberCount = 8;

    private const string SchemaRefPrefix = "#/components/schemas/";

    private readonly JsonElement _document;
    private readonly IReadOnlyList<InstantMember> _instantMembers;
    private readonly JsonSerializerOptions _options;

    /// <summary>Receives the emitted document, the mapped endpoints and the host's JSON options.</summary>
    public MatchInstantShapeProperties(
        EmittedDocumentCatalogue document,
        MappedEndpointCatalogue endpoints,
        AuthApiFactory factory)
    {
        ArgumentNullException.ThrowIfNull(document);
        ArgumentNullException.ThrowIfNull(endpoints);
        ArgumentNullException.ThrowIfNull(factory);

        _document = document.Document;
        _instantMembers = InstantMembersOf(
            endpoints.Endpoints
                .Where(static endpoint => IsMatchRoute(endpoint.Route))
                .SelectMany(static endpoint => endpoint.DeclaredSuccessResponses)
                .Select(static response => response.BodyType)
                .OfType<Type>());
        _options = factory.Services.GetRequiredService<IOptions<HttpJsonOptions>>().Value.SerializerOptions;
    }

    /// <summary>
    /// Every instant-valued member reachable from a match response contract is a <c>date-time</c>
    /// string schema in the emitted document, reported as a worklist.
    /// </summary>
    [Fact]
    public void EveryMatchInstantMemberIsADateTimeStringSchema()
    {
        IReadOnlyList<string> offences = InstantOffences(_document, _instantMembers);

        Assert.True(offences.Count == 0, Report("instant member(s) not published as date-time strings", offences));
    }

    /// <summary>
    /// No candidate-day wrapper schema is reachable from any match operation of the emitted document.
    /// </summary>
    [Fact]
    public void NoCandidateDayWrapperIsReachableFromAMatchOperation()
    {
        IReadOnlyList<string> wrappers = WrapperOffences(_document);

        Assert.True(wrappers.Count == 0, Report("candidate-day wrapper(s) reachable", wrappers));
    }

    /// <summary>
    /// The non-vacuity floors: at least eight instant-valued members were found and checked, and the
    /// match operations reach a non-empty schema set — so the wrapper sweep's zero is a measurement
    /// rather than the result of walking nothing.
    /// </summary>
    [Fact]
    public void TheSweptSurfaceIsNonVacuous()
    {
        Assert.True(
            _instantMembers.Count >= MinimumInstantMemberCount,
            $"Only {_instantMembers.Count} instant member(s) are reachable from match contracts; at least "
                + $"{MinimumInstantMemberCount} are. Found: {string.Join(", ", _instantMembers)}");

        Assert.Contains("MatchListEntry", ReachableSchemaNames(_document));
    }

    /// <summary>
    /// The planted-violation control: a synthesised document whose match contract references a
    /// candidate-day wrapper schema fails, naming it.
    /// </summary>
    [Fact]
    public void TheWrapperRuleFailsOnAContractReferencingAWrapperSchema()
    {
        using JsonDocument synthesised = JsonDocument.Parse(
            """
            {
              "paths": {
                "/squads/{squadId}/matches": {
                  "get": { "responses": {
                    "200": { "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Entry" } } } }
                  } }
                }
              },
              "components": { "schemas": {
                "Entry": { "type": "object", "properties": {
                  "candidateDays": { "type": "array", "items": { "$ref": "#/components/schemas/Day" } }
                } },
                "Day": { "type": "object", "properties": { "instant": { "type": "string", "format": "date-time" } } }
              } }
            }
            """);

        Assert.Contains(WrapperOffences(synthesised.RootElement), static offence => offence.Contains("Day", StringComparison.Ordinal));
    }

    // Feature: match-read-models, Property 21: One shape for an instant — a candidate day's wire instant
    // parses back to a candidate day equal by instant, whatever offset it was created from.
    /// <summary>
    /// **Validates: Requirements 9.1, 9.4, 9.5** — for any instant and any UTC offset from −14:00 to
    /// +14:00, the instant a candidate day emits through the host's JSON options reads back as a
    /// candidate day equal to the original.
    /// </summary>
    [Property(MaxTest = 100)]
    public Property ACandidateDaysWireInstantRoundTripsByInstant() =>
        Prop.ForAll(
            Arb.From(
                from seconds in Gen.Choose(0, int.MaxValue)
                from offsetMinutes in Gen.Choose(-14 * 60, 14 * 60)
                select new DateTimeOffset(
                    DateTime.SpecifyKind(new DateTime(2025, 1, 1).AddSeconds(seconds % (10 * 365 * 86_400)), DateTimeKind.Unspecified),
                    TimeSpan.FromMinutes(offsetMinutes))),
            created =>
            {
                var day = new CandidateDay(created);

                string json = JsonSerializer.Serialize(day.Instant, _options);
                DateTimeOffset parsed = JsonSerializer.Deserialize<DateTimeOffset>(json, _options);

                return (new CandidateDay(parsed) == day && parsed.Offset == TimeSpan.Zero)
                    .ToProperty()
                    .Label($"{created:O} -> {json} -> {parsed:O}");
            });

    // Feature: match-read-models, Property 21: the instant rule classifies synthesised member schemas.
    /// <summary>
    /// **Validates: Requirements 9.1, 9.2** — over synthesised schema shapes for one instant member, the
    /// rule passes exactly the <c>date-time</c> string forms (nullable, and as array items) and reports
    /// every other shape: an integer, a string with no format, a <c>date</c>, and a wrapper reference.
    /// </summary>
    [Property(MaxTest = 100)]
    public Property TheInstantRuleClassifiesSynthesisedShapes() =>
        Prop.ForAll(
            Arb.From(Gen.Elements(SynthesisedShapes)),
            shape =>
            {
                using JsonDocument synthesised = JsonDocument.Parse(
                    $$"""
                    { "components": { "schemas": {
                      "Holder": { "type": "object", "properties": { "at": {{shape.Schema}} } },
                      "Day": { "type": "object", "properties": { "instant": { "type": "string", "format": "date-time" } } }
                    } } }
                    """);

                IReadOnlyList<string> offences = InstantOffences(
                    synthesised.RootElement,
                    [new InstantMember("Holder", "At", shape.IsCollection)]);

                return (shape.Conforms == (offences.Count == 0))
                    .ToProperty()
                    .Label($"{shape.Schema} -> {string.Join("; ", offences)}")
                    .Collect(shape.Conforms ? "conforming" : "offending");
            });

    /// <summary>
    /// <see cref="MatchState"/>'s members each serialise to their name and read back as the same member
    /// through the host's one registered configuration (Requirement 9.11).
    /// </summary>
    [Fact]
    public void MatchStateRoundTripsByNameThroughTheHostsOptions()
    {
        foreach (MatchState state in Enum.GetValues<MatchState>())
        {
            string json = JsonSerializer.Serialize(state, _options);

            Assert.Equal($"\"{state}\"", json);
            Assert.Equal(state, JsonSerializer.Deserialize<MatchState>(json, _options));
        }
    }

    private static readonly SynthesisedShape[] SynthesisedShapes =
    [
        new("""{ "type": "string", "format": "date-time" }""", false, true),
        new("""{ "type": ["null", "string"], "format": "date-time" }""", false, true),
        new("""{ "type": "array", "items": { "type": "string", "format": "date-time" } }""", true, true),
        new("""{ "type": "integer", "format": "int64" }""", false, false),
        new("""{ "type": "string" }""", false, false),
        new("""{ "type": "string", "format": "date" }""", false, false),
        new("""{ "$ref": "#/components/schemas/Day" }""", false, false),
        new("""{ "type": "array", "items": { "$ref": "#/components/schemas/Day" } }""", true, false),
    ];

    /// <summary>Whether a mapped route belongs to the match surface.</summary>
    private static bool IsMatchRoute(string route) =>
        route.StartsWith("/matches", StringComparison.Ordinal)
        || route.Contains("/matches", StringComparison.Ordinal) && route.StartsWith("/squads", StringComparison.Ordinal);

    /// <summary>
    /// Every <see cref="DateTimeOffset"/> member (single or collection) reachable from the given
    /// contracts, keyed by the declaring contract's schema name.
    /// </summary>
    private static IReadOnlyList<InstantMember> InstantMembersOf(IEnumerable<Type> roots)
    {
        var members = new List<InstantMember>();
        var seen = new HashSet<Type>();
        var pending = new Queue<Type>(roots);

        while (pending.TryDequeue(out Type? type))
        {
            type = MatchReadContracts.ElementOrSelf(type);

            if (type.IsEnum || type.IsPrimitive || type.Namespace?.StartsWith("PitchMate.", StringComparison.Ordinal) != true
                || !seen.Add(type))
            {
                continue;
            }

            foreach (PropertyInfo property in type.GetProperties(BindingFlags.Public | BindingFlags.Instance))
            {
                Type declared = Nullable.GetUnderlyingType(property.PropertyType) ?? property.PropertyType;
                Type element = MatchReadContracts.ElementOrSelf(property.PropertyType);

                if (element == typeof(DateTimeOffset))
                {
                    members.Add(new InstantMember(type.Name, property.Name, IsCollection: declared != typeof(DateTimeOffset)));
                }
                else
                {
                    pending.Enqueue(element);
                }
            }
        }

        return members;
    }

    /// <summary>One offence per instant member whose document schema is not a <c>date-time</c> string.</summary>
    private static IReadOnlyList<string> InstantOffences(JsonElement document, IEnumerable<InstantMember> members)
    {
        var offences = new List<string>();
        JsonElement schemas = document.GetProperty("components").GetProperty("schemas");

        foreach (InstantMember member in members)
        {
            string wireName = JsonNamingPolicy.CamelCase.ConvertName(member.Member);

            if (!schemas.TryGetProperty(member.Schema, out JsonElement owner)
                || !owner.TryGetProperty("properties", out JsonElement properties)
                || !properties.TryGetProperty(wireName, out JsonElement schema))
            {
                offences.Add($"{member} has no '{wireName}' member in a '{member.Schema}' schema.");
                continue;
            }

            if (member.IsCollection)
            {
                if (!HasType(schema, "array") || !schema.TryGetProperty("items", out JsonElement items) || !IsDateTimeString(items))
                {
                    offences.Add($"{member} is not an array of date-time strings: {schema.GetRawText()}");
                }
            }
            else if (!IsDateTimeString(schema))
            {
                offences.Add($"{member} is not a date-time string: {schema.GetRawText()}");
            }
        }

        return offences;
    }

    /// <summary>
    /// One offence per candidate-day wrapper reachable from a match operation: a schema named
    /// <c>CandidateDay</c>, or an object whose only member is <c>instant</c>.
    /// </summary>
    private static IReadOnlyList<string> WrapperOffences(JsonElement document)
    {
        JsonElement schemas = document.GetProperty("components").GetProperty("schemas");

        return
        [
            .. ReachableSchemaNames(document)
                .Where(name => name == nameof(CandidateDay)
                    || schemas.TryGetProperty(name, out JsonElement schema)
                        && schema.TryGetProperty("properties", out JsonElement properties)
                        && properties.EnumerateObject().Select(static member => member.Name).SequenceEqual(["instant"]))
                .Select(static name => $"schema '{name}' wraps a candidate day's instant"),
        ];
    }

    /// <summary>Every component schema transitively referenced from a match operation of the document.</summary>
    private static IReadOnlySet<string> ReachableSchemaNames(JsonElement document)
    {
        var reached = new HashSet<string>(StringComparer.Ordinal);
        var pending = new Stack<JsonElement>();

        foreach (JsonProperty path in document.GetProperty("paths").EnumerateObject())
        {
            if (path.Name.Contains("/matches", StringComparison.Ordinal))
            {
                pending.Push(path.Value);
            }
        }

        JsonElement schemas = document.GetProperty("components").GetProperty("schemas");

        while (pending.TryPop(out JsonElement element))
        {
            switch (element.ValueKind)
            {
                case JsonValueKind.Object:
                    foreach (JsonProperty member in element.EnumerateObject())
                    {
                        if (member.Name == "$ref" && member.Value.GetString() is { } reference
                            && reference.StartsWith(SchemaRefPrefix, StringComparison.Ordinal))
                        {
                            string name = reference[SchemaRefPrefix.Length..];
                            if (reached.Add(name) && schemas.TryGetProperty(name, out JsonElement target))
                            {
                                pending.Push(target);
                            }
                        }
                        else
                        {
                            pending.Push(member.Value);
                        }
                    }

                    break;

                case JsonValueKind.Array:
                    foreach (JsonElement item in element.EnumerateArray())
                    {
                        pending.Push(item);
                    }

                    break;
            }
        }

        return reached;
    }

    /// <summary>A string schema (optionally nullable, and nothing else) with the <c>date-time</c> format.</summary>
    private static bool IsDateTimeString(JsonElement schema) =>
        schema.ValueKind == JsonValueKind.Object
        && schema.TryGetProperty("format", out JsonElement format)
        && format.GetString() == "date-time"
        && TypesOf(schema) is { Count: > 0 } types
        && types.Contains("string")
        && types.All(static type => type is "string" or "null");

    private static bool HasType(JsonElement schema, string type) => TypesOf(schema).Contains(type);

    private static IReadOnlyList<string> TypesOf(JsonElement schema) =>
        !schema.TryGetProperty("type", out JsonElement type)
            ? []
            : type.ValueKind == JsonValueKind.Array
                ? [.. type.EnumerateArray().Select(static item => item.GetString() ?? string.Empty)]
                : [type.GetString() ?? string.Empty];

    private static string Report(string subject, IReadOnlyList<string> offences) =>
        $"{offences.Count} {subject}:{Environment.NewLine}"
            + string.Join(Environment.NewLine, offences.Select(static offence => $"  - {offence}"));

    /// <summary>One instant-valued member: its contract's schema name, CLR member name and shape.</summary>
    private sealed record InstantMember(string Schema, string Member, bool IsCollection)
    {
        public override string ToString() => $"{Schema}.{Member}{(IsCollection ? "[]" : string.Empty)}";
    }

    /// <summary>A synthesised member schema and whether the rule must accept it.</summary>
    private sealed record SynthesisedShape(string Schema, bool IsCollection, bool Conforms)
    {
        public override string ToString() => Schema;
    }
}
