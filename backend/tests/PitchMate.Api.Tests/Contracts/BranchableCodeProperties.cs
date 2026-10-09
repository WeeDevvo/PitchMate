using System.Text;
using System.Text.Json;
using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace PitchMate.Api.Tests.Contracts;

/// <summary>
/// The guard for <b>Property 11 — Every non-concealed problem carries one branchable code</b>.
/// <para>
/// <b>Validates: Requirements 2.10, 2.11</b>
/// </para>
/// <para>
/// A problem body's <c>detail</c> is prose: it is written for a person, it is free to be reworded, and
/// a client that branches on it is broken by a copy edit. The <c>code</c> extension is the stable value
/// a client is meant to branch on, which is why Requirement 2.11 puts it on every problem body that is
/// not a concealed not-found. Nothing in the type system enforces that. Each seam composes the
/// extension by hand, and the failure mode is quiet: a new error code added to an existing seam, or a
/// code routed through a convenience helper that forgot the <c>extensions</c> argument, answers with a
/// perfectly reasonable status and a body the client can only tell apart by reading English.
/// </para>
/// <para>
/// So this guard drives <b>every</b> error code of <b>every</b> seam through the real seam — the codes
/// enumerated by reflection, so one added next year arrives on its own (see
/// <see cref="ProblemSeams"/>) — and requires the resulting body to carry exactly one <c>code</c>
/// member, at the body's root, whose value is that code's own name. Not merely present: equal. A
/// <c>code</c> naming the wrong code is worse than none, because a client branching on it takes the
/// wrong branch silently.
/// </para>
/// <para>
/// <b>The exclusion.</b> A concealed not-found must carry no code at all — the cause is precisely what
/// the response exists to hide (Requirement 5.2), and asserting a code on it would make the two
/// requirements contradictory. The excluded population is therefore <i>measured</i>: a code is excluded
/// when the bytes it produces are identical to the bytes its seam's fixed <c>Concealed()</c> result
/// produces. That keeps the exclusion self-maintaining in both directions, and
/// <see cref="TheConcealedExclusionIsExactlyTheCodesAnsweredByAFixedNotFound"/> pins today's excluded
/// set explicitly so it cannot widen unnoticed. The complementary fact — that those excluded responses
/// are indistinguishable from one another — is <see cref="ConcealmentProperties"/>'s subject, and this
/// guard uses them as its control population rather than re-asserting it.
/// </para>
/// <para>
/// <b>The second conjunct</b> is about the document rather than the wire: every declared problem
/// response references the one problem schema (Requirement 2.10). A single shape is what lets the
/// generated client expose one problem type with one <c>code</c> member for the whole surface; an
/// operation declaring a bespoke body would hand consumers a second type for no reason, and would do
/// so silently because the responses themselves would be unchanged. It is asserted against the
/// document the <b>running host</b> emits — see <see cref="EmittedDocumentCatalogue"/> for why not the
/// committed file.
/// </para>
/// </summary>
public sealed class BranchableCodeProperties
    : IClassFixture<ProblemCodeCatalogue>, IClassFixture<EmittedDocumentCatalogue>
{
    /// <summary>
    /// The non-vacuity floor on the driven codes: 75 are reachable today across the eight seam
    /// variants, held at 70 so the floor is a floor rather than a restatement of today's count.
    /// </summary>
    private const int MinimumDrivenCodeCount = 70;

    /// <summary>
    /// The floor on the population the rule actually ranges over, after the concealed codes are taken
    /// out. 68 are non-concealed today.
    /// </summary>
    private const int MinimumNonConcealedCodeCount = 60;

    /// <summary>
    /// The floor on the declared problem responses of the emitted document: 411 today across 67
    /// operations, held at 300.
    /// </summary>
    private const int MinimumDeclaredProblemResponseCount = 300;

    /// <summary>The members a <c>ProblemDetails</c> body shape is expected to describe.</summary>
    private static readonly string[] ProblemDetailsMembers = ["type", "title", "status", "detail"];

    /// <summary>
    /// Every error code answered by a fixed concealed not-found today, named explicitly.
    /// <para>
    /// The guard does not use this list to decide what to exclude — the exclusion is measured against
    /// the real <c>Concealed()</c> bytes. It uses it to pin the measurement: an exclusion that widened,
    /// because a code was newly routed through a concealing path, is a disclosure decision and must be
    /// a deliberate edit here rather than a silent narrowing of the population the rule ranges over.
    /// </para>
    /// </summary>
    private static readonly string[] ExpectedConcealedCodes =
    [
        "LiveTrackingErrorResults (standard): LiveTrackingErrorCode.NotFound",
        "LiveTrackingErrorResults (standard): LiveTrackingErrorCode.Unauthorized",
        "MatchErrorResults (concealed): MatchErrorCode.Unauthorized",
        "NotificationErrorResults (standard): NotificationErrorCode.NotFound",
        "SquadErrorResults (concealed): SquadErrorCode.Unauthorized",
        "StatsErrorResults (standard): StatsErrorCode.NotFound",
        "StatsErrorResults (standard): StatsErrorCode.Unauthorized",
    ];

    private readonly ProblemCodeCatalogue _codes;
    private readonly EmittedDocumentCatalogue _document;

    /// <summary>Receives the driven seam codes and the document read off the running host.</summary>
    /// <param name="codes">The captured and classified seam responses.</param>
    /// <param name="document">The emitted OpenAPI document.</param>
    public BranchableCodeProperties(ProblemCodeCatalogue codes, EmittedDocumentCatalogue document)
    {
        ArgumentNullException.ThrowIfNull(codes);
        ArgumentNullException.ThrowIfNull(document);

        _codes = codes;
        _document = document;
    }

    /// <summary>Every discovered (seam, variant) pairing, for the exhaustive floor below.</summary>
    /// <returns>One case per pairing.</returns>
    public static TheoryData<string> AllSeamVariants()
    {
        var data = new TheoryData<string>();

        foreach (string seamVariant in ProblemSeams.SeamVariants)
        {
            data.Add(seamVariant);
        }

        return data;
    }

    // Feature: api-response-contracts, Property 11: Every non-concealed problem carries one branchable
    // code — for any error code that is not answered by a concealed not-found, the problem body
    // produced for that code carries a `code` extension equal to that code's name.
    // Validates: Requirements 2.11
    [Property(MaxTest = 300)]
    [Trait("Property", "11")]
    public Property Property11_EveryNonConcealedProblemCarriesOneBranchableCode() =>
        Prop.ForAll(
            Arb.From(Gen.Elements(_codes.NonConcealed.ToArray())),
            (SeamProblem problem) =>
            {
                IReadOnlyList<string> offences = Offences([problem]);

                return (offences.Count == 0)
                    .ToProperty()
                    .Label(string.Join("; ", offences))
                    .Collect(problem.SeamVariant);
            });

    /// <summary>
    /// The exhaustive companion to the property. The driven codes are a finite discovered set, so
    /// exhausting them is strictly stronger than sampling them, and a failure reports <i>every</i>
    /// offending code as a worklist rather than the single shrunk counterexample a property failure
    /// yields.
    /// </summary>
    [Fact]
    public void EveryNonConcealedProblemCarriesItsBranchableCode()
    {
        IReadOnlyList<string> offences = Offences(_codes.NonConcealed);

        Assert.True(offences.Count == 0, Report("problems without a branchable code", offences));
    }

    // Feature: api-response-contracts, Property 11: Every non-concealed problem carries one branchable
    // code — every declared problem response in the emitted document references the one problem schema.
    // Validates: Requirements 2.10
    /// <summary>
    /// The document conjunct, over the document the running host emits: no declared problem response
    /// describes its body as anything other than the one problem shape, and none declares no body at
    /// all.
    /// </summary>
    [Fact]
    [Trait("Property", "11")]
    public void EveryDeclaredProblemResponseReferencesTheOneProblemSchema()
    {
        IReadOnlyList<string> offences = ProblemSchemaRule.Offences(_document.ProblemResponses);

        Assert.True(
            offences.Count == 0, Report("problem responses with a divergent body shape", offences));
    }

    /// <summary>
    /// What that one shape turns out to be. The rule above measures consistency and deliberately does
    /// not name a type; this asserts the shape every problem response converges on is a resolvable
    /// reference to the <see cref="ProblemDetails"/> body the seams actually write — so "they all agree"
    /// cannot be satisfied by every operation agreeing on something useless.
    /// </summary>
    [Fact]
    public void TheOneProblemSchemaIsTheProblemDetailsShape()
    {
        string identity = ProblemSchemaRule.CanonicalIdentity(_document.ProblemResponses)
            ?? throw new InvalidOperationException(
                "No declared problem response carries a schema, so there is no shape to identify.");

        Assert.StartsWith(ProblemSchemaRule.SchemaReferencePrefix, identity, StringComparison.Ordinal);
        Assert.EndsWith(nameof(ProblemDetails), identity, StringComparison.Ordinal);

        JsonElement schema = ProblemSchemaRule.Resolve(_document.Document, identity)
            ?? throw new InvalidOperationException(
                $"'{identity}' is referenced by every problem response but is not defined in the "
                    + "document's components, so the generated client would have nothing to emit.");

        Assert.True(
            schema.TryGetProperty("properties", out JsonElement properties),
            $"'{identity}' describes no properties: {schema.GetRawText()}");

        foreach (string member in ProblemDetailsMembers)
        {
            Assert.True(
                properties.TryGetProperty(member, out _),
                $"'{identity}' does not describe the '{member}' member of a problem body: "
                    + properties.GetRawText());
        }
    }

    /// <summary>
    /// The non-vacuity floor under the wire conjunct. Without it every assertion above would be
    /// satisfied by an empty set, which is exactly what a reflection or seam-discovery regression
    /// produces: the guard would go green at the moment it stopped having a subject.
    /// <para>
    /// All six seams and all eight variants are present; at least
    /// <see cref="MinimumDrivenCodeCount"/> codes were driven and at least
    /// <see cref="MinimumNonConcealedCodeCount"/> of them survive the exclusion; every surviving
    /// response is a problem status, spread across several distinct statuses, so the rule is not a
    /// statement about one status alone.
    /// </para>
    /// </summary>
    [Fact]
    public void TheDrivenCodeSetIsNonVacuous()
    {
        Assert.Equal(ProblemSeams.DeclaredSeamCount, ProblemSeams.SeamNames.Count);
        Assert.Equal(ProblemSeams.DeclaredVariantCount, ProblemSeams.SeamVariants.Count);

        Assert.True(
            _codes.Problems.Count >= MinimumDrivenCodeCount,
            $"Only {_codes.Problems.Count} error codes were driven through their seams; at least "
                + $"{MinimumDrivenCodeCount} are reachable. A rule quantified over nothing holds for "
                + "everything.");

        Assert.True(
            _codes.NonConcealed.Count >= MinimumNonConcealedCodeCount,
            $"Only {_codes.NonConcealed.Count} driven codes are not answered by a concealed "
                + $"not-found; at least {MinimumNonConcealedCodeCount} are. An exclusion that swallowed "
                + "the population would leave the rule with nothing to say.");

        Assert.All(_codes.NonConcealed, problem => Assert.InRange(problem.Status, 400, 599));

        int distinctStatuses = _codes.NonConcealed
            .Select(static problem => problem.Status)
            .Distinct()
            .Count();

        Assert.True(
            distinctStatuses >= 5,
            $"The non-concealed problems span only {distinctStatuses} distinct status(es); the rule is "
                + "meant to hold across the whole problem surface, not one status.");
    }

    /// <summary>
    /// The per-variant half of the floor: each (seam, variant) pairing drove <b>every</b> member its
    /// error-code enum reports, so no code was enumerated and then skipped — the failure that would
    /// let a brand-new code slip past the rule while the counts above still looked healthy.
    /// </summary>
    /// <param name="seamVariant">The pairing under test.</param>
    [Theory]
    [MemberData(nameof(AllSeamVariants))]
    public void EverySeamVariantDroveEveryCodeItsEnumReports(string seamVariant)
    {
        Type errorCodeType = ProblemSeams.ErrorCodeTypeOf(seamVariant);
        IReadOnlyList<SeamProblem> driven = _codes.Of(seamVariant);

        Assert.NotEmpty(driven);

        foreach (string codeName in Enum.GetNames(errorCodeType))
        {
            Assert.Contains(
                driven,
                problem => string.Equals(problem.CodeName, codeName, StringComparison.Ordinal));
        }

        Assert.Equal(Enum.GetValues(errorCodeType).Length, driven.Count);
    }

    /// <summary>
    /// Pins the measured exclusion. The set of codes answered by a fixed concealed not-found is derived
    /// from the real seam bytes, not read from <see cref="ExpectedConcealedCodes"/>; this asserts the
    /// two agree, so a code newly routed through a concealing path — a disclosure decision — cannot
    /// quietly leave the population the branchable-code rule ranges over.
    /// </summary>
    [Fact]
    public void TheConcealedExclusionIsExactlyTheCodesAnsweredByAFixedNotFound()
    {
        IReadOnlyList<string> measured =
        [
            .. _codes.ConcealedByNotFound
                .Select(static problem => problem.Description)
                .Order(StringComparer.Ordinal),
        ];

        Assert.Equal(ExpectedConcealedCodes, measured);
        Assert.All(_codes.ConcealedByNotFound, static problem =>
            Assert.Equal(StatusCodes.Status404NotFound, problem.Status));
    }

    /// <summary>
    /// The non-vacuity floor under the document conjunct: the document was read, it declares at least
    /// <see cref="MinimumDeclaredProblemResponseCount"/> problem responses, they span several statuses,
    /// and they are spread across many operations — so "they all reference one schema" is a statement
    /// about the whole surface rather than about a handful of responses that happened to be found.
    /// </summary>
    [Fact]
    public void TheEmittedProblemResponseSetIsNonVacuous()
    {
        Assert.True(
            _document.ProblemResponses.Count >= MinimumDeclaredProblemResponseCount,
            $"The emitted document declares only {_document.ProblemResponses.Count} problem "
                + $"responses; at least {MinimumDeclaredProblemResponseCount} are declared across the "
                + "surface. A rule quantified over nothing holds for everything.");

        int distinctStatuses = _document.ProblemResponses
            .Select(static fact => fact.Status)
            .Distinct()
            .Count();

        Assert.True(
            distinctStatuses >= 6,
            $"The declared problem responses span only {distinctStatuses} distinct status(es); the "
                + "six seams between them declare 400, 401, 403, 404, 409, 410, 500, 502 and 503.");

        int distinctOperations = _document.ProblemResponses
            .Select(static fact => $"{fact.Method} {fact.Path}")
            .Distinct(StringComparer.Ordinal)
            .Count();

        Assert.True(
            distinctOperations >= 60,
            $"Problem responses were found on only {distinctOperations} operation(s); all but the "
                + "liveness probe declare at least one.");
    }

    /// <summary>
    /// The discriminating control for the wire conjunct, and the reason the exclusion exists. Every
    /// concealed not-found of every concealing seam is fed through the rule as if it were in scope, and
    /// the rule must report each one — which is what shows it is not satisfied by any body at all. A
    /// rule that found a code everywhere, or nowhere, would pass the exhaustive half just as happily.
    /// </summary>
    [Fact]
    public void TheRuleFailsOnAConcealedNotFoundOfEveryConcealingSeam()
    {
        Assert.NotEmpty(_codes.ConcealedByNotFound);

        foreach (SeamProblem concealed in _codes.ConcealedByNotFound)
        {
            Assert.Empty(concealed.CodeMemberPaths);

            IReadOnlyList<string> offences = Offences([concealed]);

            Assert.Contains(
                offences,
                offence => offence.Contains(concealed.Producer, StringComparison.Ordinal)
                    && offence.Contains("code", StringComparison.Ordinal));
        }
    }

    /// <summary>
    /// The control for the equality half: a body carrying a <c>code</c> that names a <i>different</i>
    /// code is reported, naming both. A rule that only checked for presence would call it clean, and a
    /// client branching on it would take the wrong branch in silence.
    /// </summary>
    [Fact]
    public void TheRuleFailsOnAProblemCarryingAnotherCodesName()
    {
        SeamProblem honest = _codes.NonConcealed[0];
        const string Impostor = "SomeOtherCode";

        SeamProblem mislabelled = Rewritten(
            honest,
            $$"""{"title":"{{Impostor}}","status":{{honest.Status}},"code":"{{Impostor}}"}""");

        IReadOnlyList<string> offences = Offences([mislabelled]);

        Assert.Contains(
            offences,
            offence => offence.Contains(mislabelled.Producer, StringComparison.Ordinal)
                && offence.Contains(Impostor, StringComparison.Ordinal)
                && offence.Contains(honest.CodeName, StringComparison.Ordinal));
    }

    /// <summary>
    /// The control for the "exactly one, at the root" half: a body that also buries a <c>code</c>
    /// somewhere inside it is reported even though its root code is correct. One branchable value per
    /// problem is the contract; two is an ambiguity a client has to guess at.
    /// </summary>
    [Fact]
    public void TheRuleFailsOnAProblemCarryingASecondNestedCode()
    {
        SeamProblem honest = _codes.NonConcealed[0];

        SeamProblem ambiguous = Rewritten(
            honest,
            $$"""
            {"title":"{{honest.CodeName}}","status":{{honest.Status}},"code":"{{honest.CodeName}}",
             "errors":[{"code":"SomethingElse"}]}
            """);

        IReadOnlyList<string> offences = Offences([ambiguous]);

        Assert.Contains(
            offences,
            offence => offence.Contains(ambiguous.Producer, StringComparison.Ordinal)
                && offence.Contains("errors", StringComparison.Ordinal));
    }

    /// <summary>
    /// The positive control pairing the two above: the honest body they were derived from is reported
    /// clean, so the rule is discriminating rather than complaining indiscriminately.
    /// </summary>
    [Fact]
    public void TheRulePassesOnAProblemCarryingItsOwnCodeAtTheRoot()
    {
        SeamProblem honest = _codes.NonConcealed[0];

        Assert.Equal([SeamProblem.RootCodePath], honest.CodeMemberPaths);
        Assert.Equal(honest.CodeName, honest.CodeExtension);
        Assert.Empty(Offences([honest]));
    }

    /// <summary>
    /// The discriminating control for the document conjunct: a document in which one operation
    /// describes its problem body with a bespoke schema while the rest share one is reported, naming
    /// the offending path, method and status. Also covers a problem response declaring no body at all,
    /// which a check that only compared the schemas it found would pass over in silence.
    /// </summary>
    [Fact]
    public void TheDocumentRuleFailsOnAnOperationDeclaringADivergentProblemShape()
    {
        using JsonDocument synthesised = JsonDocument.Parse(
            """
            {
              "paths": {
                "/synthesised/consistent": {
                  "get": { "responses": {
                    "200": { "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Thing" } } } },
                    "400": { "content": { "application/problem+json": { "schema": { "$ref": "#/components/schemas/ProblemDetails" } } } },
                    "404": { "content": { "application/problem+json": { "schema": { "$ref": "#/components/schemas/ProblemDetails" } } } }
                  } },
                  "parameters": []
                },
                "/synthesised/divergent": {
                  "post": { "responses": {
                    "409": { "content": { "application/problem+json": { "schema": { "$ref": "#/components/schemas/BespokeProblem" } } } },
                    "500": { "description": "Internal Server Error" }
                  } }
                }
              }
            }
            """);

        IReadOnlyList<ProblemResponseFact> facts =
            ProblemSchemaRule.ProblemResponsesOf(synthesised.RootElement);

        // The 200 is not a problem response and must not be drawn into the comparison, or the rule
        // would report every operation on the real surface for disagreeing with its success body.
        Assert.DoesNotContain(facts, static fact => fact.Status < ProblemSchemaRule.MinimumProblemStatus);

        IReadOnlyList<string> offences = ProblemSchemaRule.Offences(facts);

        Assert.Contains(
            offences,
            static offence => offence.Contains("/synthesised/divergent", StringComparison.Ordinal)
                && offence.Contains("POST", StringComparison.Ordinal)
                && offence.Contains("409", StringComparison.Ordinal)
                && offence.Contains("BespokeProblem", StringComparison.Ordinal));

        Assert.Contains(
            offences,
            static offence => offence.Contains("/synthesised/divergent", StringComparison.Ordinal)
                && offence.Contains("500", StringComparison.Ordinal)
                && offence.Contains("no problem body schema", StringComparison.Ordinal));

        // And the consistent operation is reported clean, so the rule discriminates.
        Assert.DoesNotContain(
            offences,
            static offence => offence.Contains("/synthesised/consistent", StringComparison.Ordinal));
    }

    /// <summary>
    /// The control for the document rule's treatment of an <i>inlined</i> problem body. A bespoke shape
    /// written inline rather than referenced is the same defect in a different dress, and a rule that
    /// compared only <c>$ref</c> targets would miss it entirely.
    /// </summary>
    [Fact]
    public void TheDocumentRuleFailsOnAnOperationInliningItsProblemShape()
    {
        using JsonDocument synthesised = JsonDocument.Parse(
            """
            {
              "paths": {
                "/synthesised/referenced": {
                  "get": { "responses": {
                    "400": { "content": { "application/problem+json": { "schema": { "$ref": "#/components/schemas/ProblemDetails" } } } },
                    "404": { "content": { "application/problem+json": { "schema": { "$ref": "#/components/schemas/ProblemDetails" } } } }
                  } }
                },
                "/synthesised/inlined": {
                  "get": { "responses": {
                    "400": { "content": { "application/problem+json": { "schema": { "type": "object" } } } }
                  } }
                }
              }
            }
            """);

        IReadOnlyList<string> offences = ProblemSchemaRule.Offences(
            ProblemSchemaRule.ProblemResponsesOf(synthesised.RootElement));

        Assert.Contains(
            offences,
            static offence => offence.Contains("/synthesised/inlined", StringComparison.Ordinal)
                && offence.Contains(ProblemResponseFact.InlinePrefix, StringComparison.Ordinal));
    }

    /// <summary>
    /// Applies the rule to each driven code and returns one message per offence, each naming the seam,
    /// the variant and the producing code, plus the fact at fault.
    /// </summary>
    /// <param name="problems">The driven codes to check.</param>
    /// <returns>Every offence found.</returns>
    private static IReadOnlyList<string> Offences(IEnumerable<SeamProblem> problems)
    {
        var offences = new List<string>();

        foreach (SeamProblem problem in problems)
        {
            IReadOnlyList<string> codePaths = problem.CodeMemberPaths;

            if (codePaths.Count == 0)
            {
                offences.Add(
                    $"{problem.Description} answers {problem.Status} with a body carrying no 'code' "
                        + $"member: '{problem.BodyText}'. A client has nothing stable to branch on and "
                        + "would have to parse the human-readable detail.");

                continue;
            }

            if (codePaths.Count > 1
                || !string.Equals(codePaths[0], SeamProblem.RootCodePath, StringComparison.Ordinal))
            {
                offences.Add(
                    $"{problem.Description} carries {codePaths.Count} 'code' member(s), at "
                        + $"{string.Join(", ", codePaths)}: '{problem.BodyText}'. Exactly one, at the "
                        + $"problem body's root ({SeamProblem.RootCodePath}), is the branchable code.");
            }

            if (!string.Equals(problem.CodeExtension, problem.CodeName, StringComparison.Ordinal))
            {
                offences.Add(
                    $"{problem.Description} carries code '{problem.CodeExtension}' rather than "
                        + $"'{problem.CodeName}': '{problem.BodyText}'. A client branching on the "
                        + "extension would take the wrong branch in silence.");
            }
        }

        return [.. offences.Distinct(StringComparer.Ordinal)];
    }

    /// <summary>
    /// The same driven code with a hand-written body, so a control can present the rule with a defect
    /// the real seams do not produce today while keeping every other fact about the problem intact.
    /// </summary>
    private static SeamProblem Rewritten(SeamProblem problem, string body) =>
        problem with
        {
            Response = new CapturedResponse(
                problem.Response.Failure, problem.Status, Encoding.UTF8.GetBytes(body)),
        };

    /// <summary>Renders every offender in one message, so the output is a worklist.</summary>
    private static string Report(string subject, IReadOnlyList<string> offences) =>
        $"{offences.Count} {subject}:{Environment.NewLine}"
            + string.Join(Environment.NewLine, offences.Select(static offence => $"  - {offence}"));
}
