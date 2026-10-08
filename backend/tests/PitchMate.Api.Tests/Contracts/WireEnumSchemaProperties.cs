using System.Text.Json;
using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Api.Tests.Serialisation;

namespace PitchMate.Api.Tests.Contracts;

/// <summary>
/// The guard for <b>Property 8 — Every wire enum is a named string schema</b>.
/// <para>
/// <b>Validates: Requirements 4.4, 13.7</b>
/// </para>
/// <para>
/// Registering the by-name converter changes two things at once, and only one of them is visible on
/// the wire. Property 6 covers the wire: every enum member serialises as its own name. This covers the
/// <i>document</i>: that the schemas the exporter derives from the same options publish that same
/// vocabulary, so the generated TypeScript client gets a union of member names rather than a
/// <c>number</c>. The failure mode is quiet and specific — the responses stay correct while the
/// document describes an enum as <c>{"type":"integer"}</c>, the client is generated against that, and
/// nothing fails until a consumer compares a name to a number.
/// </para>
/// <para>
/// <b>Reachability is resolved from the document.</b> The candidate enums are discovered by reflection
/// over the Domain and Application assemblies (<see cref="WireEnums.PublicByName"/>); which of them
/// the rule ranges over is decided by walking the emitted document from every declared response
/// contract and request body. Nothing here names a reachable enum, so an enum that reaches a contract
/// later is covered unedited.
/// </para>
/// <para>
/// <b>Why the floor is 15 and not 17.</b> The design lists 17 wire enums, and Property 6 holds all 17
/// to their names at the serialiser. Only 15 enum schemas are reachable from a declared contract in
/// the emitted document, and the two sets are not nested: <c>MatchState</c>, <c>PlayerResult</c> and
/// <c>GuestClaimState</c> are not carried by any declared contract today (there is no match-detail
/// read, <c>PlayerRecord</c> carries counts rather than per-match results, and the guest-claim
/// initiation answers with a claim id alone), while <c>LiveTrackingErrorCode</c> is published on a
/// batch result without being on the design's list. The three absent ones still serialise by name at
/// runtime and are covered there by Property 6's 17-enum floor; a document rule cannot say anything
/// about a schema the document does not contain. The floor here is therefore 15, and it is the one
/// numeric literal in this guard — the reachable set itself is measured.
/// </para>
/// <para>
/// <b>Why the literal <c>type: string</c> keyword is not asserted.</b> See
/// <see cref="EnumSchemaRule"/>: .NET 10's exporter describes a by-name enum by its values alone and
/// emits no <c>type</c> keyword, so the requirement's "string schema" is enforced as its substance —
/// string-valued members equal to the member names, and never an integer or numeric schema.
/// </para>
/// </summary>
public sealed class WireEnumSchemaProperties : IClassFixture<EmittedDocumentCatalogue>
{
    /// <summary>
    /// The non-vacuity floor on the enum schemas reachable from a declared contract. Exactly 15 are
    /// reachable today, so this is a floor the surface sits on rather than above: a wire enum that
    /// stopped being published as a named schema — the integer regression this guard exists for —
    /// drops the count below it and fails here even though the rule itself would have nothing to
    /// report.
    /// </summary>
    private const int MinimumDocumentReachableEnumCount = 15;

    private readonly IReadOnlyList<EnumSchemaFact> _enumSchemas;
    private readonly IReadOnlyDictionary<string, Type> _matched;

    /// <summary>Receives the document read off the running host.</summary>
    /// <param name="document">The emitted OpenAPI document.</param>
    public WireEnumSchemaProperties(EmittedDocumentCatalogue document)
    {
        ArgumentNullException.ThrowIfNull(document);

        _enumSchemas = EnumSchemaRule.EnumSchemasOf(document.Document);
        _matched = EnumSchemaRule.MatchedEnums(_enumSchemas, WireEnums.PublicByName);
    }

    // Feature: api-response-contracts, Property 8: Every wire enum is a named string schema — for any
    // enum reachable from a response contract or a request body of the emitted document, that enum's
    // schema is a named schema whose enumerated values are JSON strings equal to that enum's member
    // names exactly, so no wire enum appears in the document as an integer schema.
    // Validates: Requirements 4.4, 13.7
    [Property(MaxTest = 300)]
    [Trait("Property", "8")]
    public Property Property8_EveryWireEnumIsANamedStringSchema() =>
        Prop.ForAll(
            Arb.From(Gen.Elements(_enumSchemas.ToArray())),
            (EnumSchemaFact fact) =>
            {
                IReadOnlyList<string> offences =
                    EnumSchemaRule.Offences([fact], WireEnums.PublicByName);

                return (offences.Count == 0)
                    .ToProperty()
                    .Label(string.Join("; ", offences))
                    .Collect(fact.SchemaName ?? "inlined");
            });

    /// <summary>
    /// The exhaustive companion to the property. The reachable enum schemas are a finite discovered
    /// set, so exhausting them is strictly stronger than sampling them, and a failure reports every
    /// offending schema as a worklist rather than the single shrunk counterexample a property failure
    /// yields.
    /// </summary>
    [Fact]
    [Trait("Property", "8")]
    public void EveryReachableEnumSchemaPublishesItsEnumsMemberNames()
    {
        IReadOnlyList<string> offences =
            EnumSchemaRule.Offences(_enumSchemas, WireEnums.PublicByName);

        Assert.True(offences.Count == 0, Report("enum schemas that misdescribe their vocabulary", offences));
    }

    /// <summary>
    /// The non-vacuity floor. Without it every assertion above is satisfied by an empty set — which is
    /// precisely the state the pre-change surface was in, where enums crossed the wire as integers and
    /// appeared in the document as nameless <c>{"type":"integer"}</c> schemas with no vocabulary to
    /// check at all.
    /// <para>
    /// Also pins that every reachable enum schema is named and matched to a CLR enum, so the rule
    /// cannot be passing because the matching quietly found nothing to compare against, and that no
    /// published schema name is one of the ambiguous ones the candidate discovery had to exclude.
    /// </para>
    /// </summary>
    [Fact]
    [Trait("Property", "8")]
    public void TheDocumentReachableEnumSetIsNonVacuous()
    {
        // Ambiguity only matters where it would block matching a published schema: two assemblies may
        // legitimately declare an unpublished enum of the same name (see WireEnums).
        Assert.Empty(
            _enumSchemas
                .Select(static fact => fact.SchemaName)
                .OfType<string>()
                .Intersect(WireEnums.AmbiguousPublicTypeNames, StringComparer.Ordinal));

        Assert.True(
            _matched.Count >= MinimumDocumentReachableEnumCount,
            $"Only {_matched.Count} enum(s) are reachable from a declared response contract or request "
                + $"body of the emitted document; at least {MinimumDocumentReachableEnumCount} are "
                + "published as named schemas. A rule quantified over nothing holds for everything, "
                + "and an enum serialised as an integer does not reach the document as a named schema "
                + $"at all. Found: {string.Join(", ", _matched.Keys)}");

        // Every enumerating schema on the reachable surface was matched, so the rule ranged over all
        // of them rather than over the subset whose names happened to resolve.
        Assert.Equal(_enumSchemas.Count, _matched.Count);

        Assert.All(_enumSchemas, static fact =>
        {
            Assert.NotNull(fact.SchemaName);
            Assert.NotEmpty(fact.StringValues);
            Assert.Empty(fact.OtherValues);
        });
    }

    /// <summary>
    /// Each reachable enum schema publishes the whole vocabulary of its CLR enum and nothing besides,
    /// named individually so a failure identifies the exact enum rather than a shrunk counterexample.
    /// <c>null</c> is the only value permitted beyond the member names, and only because the exporter
    /// folds reference-site nullability into the shared named schema.
    /// </summary>
    [Fact]
    [Trait("Property", "8")]
    public void EachReachableEnumSchemaEnumeratesExactlyItsMemberNames()
    {
        foreach (EnumSchemaFact fact in _enumSchemas)
        {
            Type clrEnum = _matched[fact.SchemaName!];

            Assert.Equal(
                Enum.GetNames(clrEnum).Order(StringComparer.Ordinal),
                fact.StringValues.Order(StringComparer.Ordinal));

            Assert.Equal(Enum.GetValues(clrEnum).Length, fact.StringValues.Count);
            Assert.Equal(fact.StringValues.Count + (fact.AllowsNull ? 1 : 0), fact.ValueCount);
        }
    }

    /// <summary>
    /// The discriminating control, and the defect the whole guard exists for: an enum published as an
    /// integer schema is reported, naming the schema and the type keyword. A rule that only compared
    /// string values would call a numeric vocabulary clean because it carries no string values to
    /// disagree with.
    /// </summary>
    [Fact]
    public void TheRuleFailsOnAnEnumPublishedAsAnIntegerSchema()
    {
        IReadOnlyList<string> offences = OffencesOfSynthesised(
            """
            {
              "paths": {
                "/synthesised/squads/{id}": {
                  "get": { "responses": {
                    "200": { "content": { "application/json": { "schema": { "$ref": "#/components/schemas/SquadRole" } } } }
                  } }
                }
              },
              "components": { "schemas": {
                "SquadRole": { "type": "integer", "enum": [0, 1, 2] }
              } }
            }
            """);

        Assert.Contains(
            offences,
            static offence => offence.Contains("SquadRole", StringComparison.Ordinal)
                && offence.Contains("integer", StringComparison.Ordinal));

        Assert.Contains(
            offences,
            static offence => offence.Contains("SquadRole", StringComparison.Ordinal)
                && offence.Contains("not JSON strings", StringComparison.Ordinal));
    }

    /// <summary>
    /// The control for the vocabulary half: a schema that drops a member and invents one is reported,
    /// naming both. A client generated from either defect compiles perfectly and then fails to match a
    /// value the Api really sends.
    /// </summary>
    [Fact]
    public void TheRuleFailsOnASchemaThatMisnamesItsVocabulary()
    {
        IReadOnlyList<string> offences = OffencesOfSynthesised(
            """
            {
              "paths": {
                "/synthesised/squads": {
                  "post": {
                    "requestBody": { "content": { "application/json": { "schema": { "$ref": "#/components/schemas/SquadRole" } } } },
                    "responses": {}
                  }
                }
              },
              "components": { "schemas": {
                "SquadRole": { "enum": ["Owner", "Admin", "Captain"] }
              } }
            }
            """);

        Assert.Contains(
            offences,
            static offence => offence.Contains("does not enumerate", StringComparison.Ordinal)
                && offence.Contains("Member", StringComparison.Ordinal));

        Assert.Contains(
            offences,
            static offence => offence.Contains("not member names", StringComparison.Ordinal)
                && offence.Contains("Captain", StringComparison.Ordinal));
    }

    /// <summary>
    /// The control for the "named" half: a vocabulary inlined on a contract rather than published as a
    /// component schema is reported. The values would be right and the generated client would still
    /// carry an anonymous union per contract instead of the one shared enum type, which is what
    /// Requirement 4.4 asks for.
    /// </summary>
    [Fact]
    public void TheRuleFailsOnAVocabularyInlinedOnAContract()
    {
        IReadOnlyList<string> offences = OffencesOfSynthesised(
            """
            {
              "paths": {
                "/synthesised/inlined": {
                  "get": { "responses": {
                    "200": { "content": { "application/json": { "schema": {
                      "type": "object",
                      "properties": { "role": { "enum": ["Owner", "Admin", "Member"] } }
                    } } } }
                  } }
                }
              },
              "components": { "schemas": {} }
            }
            """);

        Assert.Contains(
            offences,
            static offence => offence.Contains("inline", StringComparison.Ordinal)
                && offence.Contains("/synthesised/inlined", StringComparison.Ordinal));
    }

    /// <summary>
    /// The control for reachability: an enum schema the document defines but no contract references is
    /// not drawn into the rule. This is what lets the guard be true of the 15 published enums without
    /// asserting anything about the ones no contract carries — and it has to be measured rather than
    /// assumed, or the rule would be quantified over the components section instead of over the
    /// reachable surface.
    /// </summary>
    [Fact]
    public void TheRuleIgnoresAnEnumSchemaNoContractReferences()
    {
        const string Document = """
            {
              "paths": {
                "/synthesised/reachable": {
                  "get": { "responses": {
                    "200": { "content": { "application/json": { "schema": { "$ref": "#/components/schemas/SquadRole" } } } }
                  } }
                }
              },
              "components": { "schemas": {
                "SquadRole": { "enum": ["Owner", "Admin", "Member"] },
                "MatchState": { "type": "integer", "enum": [0, 1, 2, 3, 4, 5] }
              } }
            }
            """;

        using JsonDocument synthesised = JsonDocument.Parse(Document);

        IReadOnlyList<EnumSchemaFact> facts = EnumSchemaRule.EnumSchemasOf(synthesised.RootElement);

        Assert.Equal(["SquadRole"], facts.Select(static fact => fact.SchemaName));
        Assert.Empty(EnumSchemaRule.Offences(facts, WireEnums.PublicByName));
    }

    /// <summary>
    /// The positive control pairing the three failing ones: a correct document is reported clean,
    /// including the nullable form the exporter emits for a nullable reference site — so the rule is
    /// discriminating rather than complaining indiscriminately, and the <c>null</c> tolerance is a
    /// stated allowance rather than an accident.
    /// </summary>
    [Fact]
    public void TheRulePassesOnAStringVocabularyWithAndWithoutTheNullableForm()
    {
        IReadOnlyList<string> offences = OffencesOfSynthesised(
            """
            {
              "paths": {
                "/synthesised/correct": {
                  "get": { "responses": {
                    "200": { "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Member" } } } }
                  } }
                }
              },
              "components": { "schemas": {
                "Member": {
                  "type": "object",
                  "properties": {
                    "role": { "$ref": "#/components/schemas/SquadRole" },
                    "state": { "$ref": "#/components/schemas/MembershipState" }
                  }
                },
                "SquadRole": { "enum": ["Owner", "Admin", "Member", null] },
                "MembershipState": { "type": "string", "enum": ["Active", "Inactive"] }
              } }
            }
            """);

        Assert.Empty(offences);
    }

    /// <summary>Renders every offender in one message, so the output is a worklist.</summary>
    private static string Report(string subject, IReadOnlyList<string> offences) =>
        $"{offences.Count} {subject}:{Environment.NewLine}"
            + string.Join(Environment.NewLine, offences.Select(static offence => $"  - {offence}"));

    /// <summary>Applies the rule to a synthesised document, against the real candidate enums.</summary>
    private static IReadOnlyList<string> OffencesOfSynthesised(string document)
    {
        using JsonDocument synthesised = JsonDocument.Parse(document);

        return EnumSchemaRule.Offences(
            EnumSchemaRule.EnumSchemasOf(synthesised.RootElement), WireEnums.PublicByName);
    }
}
