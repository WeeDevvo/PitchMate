using System.Collections.Concurrent;
using System.Text.Json;
using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace PitchMate.Api.Tests.Contracts;

/// <summary>
/// <b>Property 17 — Every mapped route parameter is a declared parameter.</b>
/// <para>
/// <b>Validates: Requirements 7.1, 7.2, 7.5, 12.11</b>
/// </para>
/// <para>
/// This is the guard the six unreachable operations needed and did not have.
/// <c>MapGroup("/squads/{squadId:guid}/matches")</c> supplied a route value that no handler bound, so
/// the emitted document described six operations whose generated path type omitted a segment the URL
/// cannot be built without — and every existing guard stayed green, because each of them asked about
/// responses, statuses or schemas and none of them compared a route template to its bindings. Correcting
/// the six is task 2.3's job; keeping them corrected is this property's.
/// </para>
/// <para>
/// The property has three parts, and they answer different questions.
/// </para>
/// <para>
/// The <b>mapped-surface half</b> quantifies over every endpoint the running host reports — not a list
/// in the test — and asserts that each parameter of its <see cref="RouteEndpoint.RoutePattern"/> appears
/// among the parameters its handler binds, read off the framework's own
/// <see cref="Microsoft.AspNetCore.Http.Metadata.IParameterBindingMetadata"/>. Because the surface is a
/// finite discovered set, exhausting it is strictly stronger than sampling it, which is why this half is
/// a fact rather than a generator. It also covers the whole surface rather than the match subset: an
/// unbound route parameter is the same defect wherever it is mapped (Requirement 7.2's claim that the
/// per-match group already declares everything it names is a consequence of this half, not a separate
/// assertion).
/// </para>
/// <para>
/// The <b>document half</b> asks the question a client developer actually cares about (Requirement
/// 12.11): for every match operation of the document the host emits, is each parameter of the path
/// template published as a <c>required</c> <c>in: path</c> parameter of that operation? A bound handler
/// parameter and a required path parameter are two different facts and either can go missing without
/// the other, so both are asserted, through one rule applied to two readings of the same operation (see
/// <see cref="RouteParameterFact"/>). The document is read off the <b>running host</b> rather than the
/// committed <c>packages/api-client/openapi/v1.json</c> — see <see cref="EmittedDocumentCatalogue"/> for
/// why, and note that in this chore the committed file is deliberately stale until task 8.1, so a guard
/// reading it would be asserting against the pre-correction surface.
/// </para>
/// <para>
/// The <b>discriminating half</b> is the part that earns the property. On their own the two exhaustive
/// halves re-state what task 2.3 already made green, and a rule that reported nothing for anything would
/// satisfy both. So the same rule is applied to endpoints synthesised precisely to break it — a real
/// endpoint, built by the real route builder from a real route-handler delegate, whose template names
/// two or three parameters and whose handler binds all but one — and each must be reported in a message
/// naming that route, that method and the unbound parameter. Each case carries a well-formed twin at the
/// same route and method, which must be reported clean, so the rule is shown to discriminate rather than
/// to object indiscriminately. The document rule carries its own planted control, since "absent" and
/// "declared optional" are different ways for a path parameter to be unusable.
/// </para>
/// </summary>
public sealed class DeclaredRouteParameterProperties
    : IClassFixture<RouteParameterCatalogue>, IClassFixture<EmittedDocumentCatalogue>
{
    /// <summary>
    /// The non-vacuity floor on the mapped surface: the 66 operations the committed document described
    /// before <c>api-response-contracts</c> plus <c>GET /auth/me</c>.
    /// <para>
    /// <b>Raised to 70 in task 16.2</b>, once the Match_List_Read, the Match_Detail_Read and the
    /// Working_Teams_Read have all landed (Requirements 12.5, 12.6). It is asserted as a minimum rather
    /// than an equality, so it fails when an endpoint is lost and does not fail when a later chore adds
    /// one — and it is a named constant precisely so raising it is a one-line edit here.
    /// </para>
    /// </summary>
    private const int MinimumInspectedEndpointCount = 67;

    /// <summary>
    /// The non-vacuity floor on the match operations of the emitted document: the 21 the surface
    /// publishes today — seven squad-scoped, eleven per-match lifecycle, three live-tracking.
    /// <para>
    /// A minimum, for the same reason as above: the three new reads of this chore push it to 24 without
    /// this line needing to move, while a discovery regression that stopped recognising match paths
    /// drops below it and fails rather than passing over an empty set.
    /// </para>
    /// </summary>
    private const int MinimumInspectedMatchOperationCount = 21;

    /// <summary>
    /// The six operations of Requirement 7.1, by document path and method, each with the parameters its
    /// own path template names.
    /// <para>
    /// This is a hand-written list, deliberately, and it is the only one in the file: Requirement 7.1
    /// names these six operations and asserts something specific about them, so a guard that only
    /// quantified over the discovered set would pass unchanged if all six vanished from the document.
    /// The discovered-set halves above are what keep the <i>rule</i> honest; this pins the <i>claim</i>.
    /// </para>
    /// </summary>
    public static TheoryData<string, string, string[]> TheSixCorrectedOperations() => new()
    {
        { "/squads/{squadId}/matches/{matchId}/availability", "PUT", ["squadId", "matchId"] },
        { "/squads/{squadId}/matches/{matchId}/availability", "DELETE", ["squadId", "matchId"] },
        { "/squads/{squadId}/matches/{matchId}/availability/tally", "GET", ["squadId", "matchId"] },
        { "/squads/{squadId}/matches/{matchId}/confirm", "POST", ["squadId", "matchId"] },
        { "/squads/{squadId}/matches/{matchId}/participants", "POST", ["squadId", "matchId"] },
        {
            "/squads/{squadId}/matches/{matchId}/participants/{membershipId}",
            "DELETE",
            ["squadId", "matchId", "membershipId"]
        },
    };

    private readonly RouteParameterCatalogue _catalogue;
    private readonly IReadOnlyList<RouteParameterFact> _matchOperations;

    /// <summary>
    /// Receives the endpoints read off the running host and the document it emits.
    /// </summary>
    /// <param name="catalogue">The discovered endpoint catalogue.</param>
    /// <param name="document">The emitted OpenAPI document.</param>
    public DeclaredRouteParameterProperties(
        RouteParameterCatalogue catalogue,
        EmittedDocumentCatalogue document)
    {
        ArgumentNullException.ThrowIfNull(catalogue);
        ArgumentNullException.ThrowIfNull(document);

        _catalogue = catalogue;
        _matchOperations = RouteParameterRule.MatchOperationsOf(document.Document);
    }

    /// <summary>
    /// Every way a route parameter can be left unbound, named individually for the exhaustive companion
    /// to the generated half.
    /// </summary>
    /// <returns>One case per defect.</returns>
    public static TheoryData<string> AllDefects()
    {
        var data = new TheoryData<string>();

        foreach (string defectName in SynthesisedRouteParameterCase.DefectNames)
        {
            data.Add(defectName);
        }

        return data;
    }

    // Feature: match-read-models, Property 17: Every mapped route parameter is a declared parameter.
    // Validates: Requirements 7.1, 7.2, 7.5
    /// <summary>
    /// The mapped-surface half: every parameter named in a mapped endpoint's route pattern appears among
    /// the parameters its handler binds. Quantified over the discovered set, so an endpoint mapped next
    /// year enters this assertion without the test being edited.
    /// </summary>
    [Fact]
    [Trait("Property", "17")]
    public void Property17_EveryMappedRouteParameterIsADeclaredParameter()
    {
        IReadOnlyList<string> violations =
            RouteParameterRule.UnboundRouteParameters(_catalogue.Endpoints);

        Assert.True(violations.Count == 0, Report("unbound route parameters", violations));
    }

    // Feature: match-read-models, Property 17: Every mapped route parameter is a declared parameter.
    // Validates: Requirements 7.1, 7.2, 12.11
    /// <summary>
    /// The document half: every parameter of every match operation's path template is published as a
    /// <c>required</c> path parameter of that operation, so the generated client requires a caller to
    /// supply every segment of the URL rather than leaving one to be substituted by hand.
    /// </summary>
    [Fact]
    [Trait("Property", "17")]
    public void Property17_EveryMatchOperationDeclaresEveryPathTemplateParameterAsRequired()
    {
        IReadOnlyList<string> violations = RouteParameterRule.UnboundRouteParameters(_matchOperations);

        Assert.True(
            violations.Count == 0,
            Report("match operations with an undeclared path parameter", violations));
    }

    // Feature: match-read-models, Property 17: Every mapped route parameter is a declared parameter.
    // Validates: Requirements 7.5
    /// <summary>
    /// The discriminating half, over arbitrary routes and methods: an endpoint whose handler leaves one
    /// of its route parameters unbound is reported, the report names that endpoint's route, method and
    /// unbound parameter, and the well-formed twin at the same route and method is reported clean.
    /// <para>
    /// The route and method are generated rather than fixed so the naming conjunct is a statement about
    /// the rule's message construction — it names whatever endpoint it was handed — rather than a
    /// coincidence of one hard-coded string. The twin binds its route parameters <i>and</i> a
    /// cancellation token, so it also pins the rule's one-directionality: declaring more than the
    /// template names is ordinary, not an offence.
    /// </para>
    /// </summary>
    /// <param name="synthesised">The synthesised offending endpoint and its well-formed twin.</param>
    /// <returns>The property.</returns>
    [Property(MaxTest = 150, Arbitrary = new[] { typeof(SynthesisedRouteParameterCaseGenerators) })]
    [Trait("Property", "17")]
    public Property Property17_AnEndpointLeavingARouteParameterUnboundIsReportedNamingIt(
        SynthesisedRouteParameterCase synthesised)
    {
        ArgumentNullException.ThrowIfNull(synthesised);

        IReadOnlyList<string> reported =
            RouteParameterRule.UnboundRouteParameters(synthesised.Offender);
        IReadOnlyList<string> twin =
            RouteParameterRule.UnboundRouteParameters(synthesised.WellFormed);

        bool failsNamingTheParameter = reported.Count == 1
            && reported[0].Contains(synthesised.Route, StringComparison.Ordinal)
            && reported[0].Contains(synthesised.Method, StringComparison.Ordinal)
            && reported[0].Contains(
                $"'{synthesised.UnboundParameter}'",
                StringComparison.Ordinal);

        return (failsNamingTheParameter && twin.Count == 0)
            .ToProperty()
            .Label(
                $"{synthesised}: reported [{string.Join(" | ", reported)}]; "
                    + $"well-formed twin reported [{string.Join(" | ", twin)}]")
            .Collect(synthesised.DefectName);
    }

    /// <summary>
    /// The exhaustive companion to the discriminating half: all three ways a route parameter can be left
    /// unbound, named individually so a failure identifies the defect rather than a shrunk
    /// counterexample.
    /// </summary>
    /// <param name="defectName">The defect under test.</param>
    [Theory]
    [MemberData(nameof(AllDefects))]
    [Trait("Property", "17")]
    public void EachWayOfLeavingARouteParameterUnboundIsReportedNamingTheRouteAndMethod(string defectName)
    {
        SynthesisedRouteParameterCase synthesised =
            SynthesisedRouteParameterCase.For("PATCH", defectName, ["widgets"]);

        IReadOnlyList<string> reported =
            RouteParameterRule.UnboundRouteParameters(synthesised.Offender);

        string message = Assert.Single(reported);
        Assert.Contains(synthesised.Route, message, StringComparison.Ordinal);
        Assert.Contains(synthesised.Method, message, StringComparison.Ordinal);
        Assert.Contains($"'{synthesised.UnboundParameter}'", message, StringComparison.Ordinal);

        // The synthesised endpoint is real: the framework bound every parameter except the planted one,
        // so the control is about the rule rather than about a fact the test asserted into existence.
        Assert.Equal(
            synthesised.Offender.RoutePatternParameters.Count - 1,
            synthesised.Offender.RoutePatternParameters.Count(synthesised.Offender.Declares));

        // The rule discriminates: the same route and method, binding every route parameter, is clean.
        Assert.Empty(RouteParameterRule.UnboundRouteParameters(synthesised.WellFormed));
    }

    /// <summary>
    /// The document rule's planted control, and the second way a path parameter can be unusable: an
    /// operation that omits a template parameter altogether is reported, and so is one that declares it
    /// <c>required: false</c> or outside the path. A rule that only looked for the <i>name</i> would call
    /// an optional path parameter clean, and the generated client would type the segment as optional —
    /// the same unbuildable URL by another route (Requirement 12.11).
    /// </summary>
    [Fact]
    [Trait("Property", "17")]
    public void TheDocumentRuleFailsOnAnAbsentAndOnAnOptionalPathParameter()
    {
        IReadOnlyList<RouteParameterFact> planted = MatchOperationsOfSynthesised(
            """
            {
              "paths": {
                "/squads/{squadId}/matches/{matchId}/absent": {
                  "get": { "parameters": [
                    { "name": "matchId", "in": "path", "required": true, "schema": { "type": "string" } }
                  ] }
                },
                "/squads/{squadId}/matches/{matchId}/optional": {
                  "put": { "parameters": [
                    { "name": "squadId", "in": "path", "required": false, "schema": { "type": "string" } },
                    { "name": "matchId", "in": "path", "required": true, "schema": { "type": "string" } }
                  ] }
                },
                "/squads/{squadId}/matches/{matchId}/mislocated": {
                  "post": { "parameters": [
                    { "name": "squadId", "in": "query", "required": true, "schema": { "type": "string" } },
                    { "name": "matchId", "in": "path", "required": true, "schema": { "type": "string" } }
                  ] }
                },
                "/squads/{squadId}/matches/{matchId}/well-formed": {
                  "delete": { "parameters": [
                    { "name": "squadId", "in": "path", "required": true, "schema": { "type": "string" } },
                    { "name": "matchId", "in": "path", "required": true, "schema": { "type": "string" } }
                  ] }
                },
                "/squads/{squadId}/members/{membershipId}": {
                  "get": { "parameters": [] }
                }
              }
            }
            """);

        // Discovery first: the four match paths are read, and the squad path that is not a match path is
        // not — otherwise the control below could be reporting the wrong operations.
        Assert.Equal(4, planted.Count);

        foreach (string defective in (string[])["absent", "optional", "mislocated"])
        {
            RouteParameterFact operation =
                Assert.Single(planted, fact => fact.Route.EndsWith(defective, StringComparison.Ordinal));

            string message =
                Assert.Single(RouteParameterRule.UnboundRouteParameters(operation));

            Assert.Contains(operation.Route, message, StringComparison.Ordinal);
            Assert.Contains(operation.Method, message, StringComparison.Ordinal);
            Assert.Contains("'squadId'", message, StringComparison.Ordinal);
            Assert.Contains(RouteParameterFact.RequiredPathParameter, message, StringComparison.Ordinal);
        }

        RouteParameterFact clean =
            Assert.Single(planted, static fact => fact.Route.EndsWith("well-formed", StringComparison.Ordinal));

        Assert.Empty(RouteParameterRule.UnboundRouteParameters(clean));
    }

    /// <summary>
    /// Requirements 7.1 and 12.11, pinned on the six operations the requirement names: each is present
    /// in the emitted document and declares every parameter of its own path template as a required path
    /// parameter — <c>squadId</c> and <c>matchId</c> for five of them, and <c>membershipId</c> as well
    /// for <c>RemoveParticipant</c>, the one of the six whose template names it.
    /// </summary>
    /// <param name="path">The operation's document path.</param>
    /// <param name="method">The operation's HTTP method.</param>
    /// <param name="expectedParameters">Every parameter that path template names.</param>
    [Theory]
    [MemberData(nameof(TheSixCorrectedOperations))]
    [Trait("Property", "17")]
    public void EachCorrectedOperationDeclaresEveryParameterOfItsOwnPathTemplate(
        string path,
        string method,
        string[] expectedParameters)
    {
        ArgumentNullException.ThrowIfNull(expectedParameters);

        RouteParameterFact operation = Assert.Single(
            _matchOperations,
            fact => string.Equals(fact.Route, path, StringComparison.Ordinal)
                && string.Equals(fact.Method, method, StringComparison.Ordinal));

        // The template itself is read from the document, so a path that lost a segment fails here rather
        // than quietly shortening the set the rule ranges over.
        Assert.Equal(expectedParameters, operation.RoutePatternParameters);

        Assert.All(expectedParameters, parameter =>
            Assert.True(
                operation.Declares(parameter),
                $"{operation.Description} does not declare '{parameter}' as a required path parameter; "
                    + $"it declares [{string.Join(", ", operation.DeclaredParameters)}]."));
    }

    /// <summary>
    /// The non-vacuity floor (Requirement 13.16). Without it both exhaustive halves are satisfied by an
    /// empty set — which is exactly what a change to how endpoints or match paths are discovered would
    /// produce: the guard would go green at the moment it stopped looking at anything.
    /// <para>
    /// At least <see cref="MinimumInspectedEndpointCount"/> endpoints and
    /// <see cref="MinimumInspectedMatchOperationCount"/> match operations were inspected; every one of
    /// them is described well enough to judge; and the populations the rule actually judges are
    /// non-empty — endpoints whose template names a parameter, and among them at least one naming three,
    /// which is the shape <c>RemoveParticipant</c> has and the shape most likely to lose one quietly.
    /// </para>
    /// </summary>
    [Fact]
    [Trait("Property", "17")]
    public void TheInspectedSurfaceIsNonVacuous()
    {
        Assert.True(
            _catalogue.Endpoints.Count >= MinimumInspectedEndpointCount,
            $"Endpoint discovery found {_catalogue.Endpoints.Count} endpoints; "
                + $"at least {MinimumInspectedEndpointCount} are mapped. "
                + "A rule quantified over nothing holds for everything.");

        Assert.True(
            _matchOperations.Count >= MinimumInspectedMatchOperationCount,
            $"Only {_matchOperations.Count} match operation(s) were read out of the emitted document; "
                + $"at least {MinimumInspectedMatchOperationCount} are published. "
                + "A document rule that discovered no operations would report no offenders.");

        Assert.All(_catalogue.Endpoints, endpoint =>
        {
            Assert.StartsWith("/", endpoint.Route, StringComparison.Ordinal);
            Assert.NotEqual("(any)", endpoint.Method);
        });

        // The rule's actual subject on the mapped surface: endpoints whose template names something.
        Assert.True(
            _catalogue.ParameterisedEndpoints.Count >= MinimumInspectedMatchOperationCount,
            $"Only {_catalogue.ParameterisedEndpoints.Count} mapped endpoint(s) name a route parameter; "
                + "the rule judges only those, so a near-empty population is a discovery regression.");

        Assert.Contains(
            _catalogue.ParameterisedEndpoints,
            static endpoint => endpoint.RoutePatternParameters.Count >= 3);

        Assert.Contains(
            _matchOperations,
            static operation => operation.RoutePatternParameters.Count >= 3);

        // Both route groups of the match surface reached the document, so neither prefix is silently
        // absent from the half that judges the generated client's path types.
        Assert.Contains(
            _matchOperations,
            static operation => operation.Route.StartsWith("/matches/", StringComparison.Ordinal));
        Assert.Contains(
            _matchOperations,
            static operation => operation.Route.StartsWith("/squads/", StringComparison.Ordinal));
    }

    /// <summary>Reads match operations out of a synthesised document, for the planted controls.</summary>
    private static IReadOnlyList<RouteParameterFact> MatchOperationsOfSynthesised(string json)
    {
        using JsonDocument document = JsonDocument.Parse(json);

        return RouteParameterRule.MatchOperationsOf(document.RootElement);
    }

    /// <summary>
    /// Renders every offender in one message. The guard's output is a worklist, so it names all of them
    /// rather than shrinking to the first.
    /// </summary>
    private static string Report(string subject, IReadOnlyList<string> failures) =>
        $"{failures.Count} {subject}:{Environment.NewLine}"
            + string.Join(Environment.NewLine, failures.Select(static failure => $"  - {failure}"));
}

/// <summary>
/// An endpoint that was never mapped: a real endpoint, built by the real route builder from a real
/// route-handler delegate, whose route template names one more parameter than its handler binds — so the
/// route-parameter rule can be shown to <i>reject</i> something.
/// <para>
/// It is built through <see cref="WebApplication"/> and projected through the production
/// <see cref="RouteParameterFact.From(RouteEndpoint)"/>, not hand-built as a
/// <see cref="RouteParameterFact"/> literal, and that matters more here than anywhere else in this
/// folder. The whole rule turns on the framework's own
/// <see cref="Microsoft.AspNetCore.Http.Metadata.IParameterBindingMetadata"/>: a hand-built literal
/// would prove only that the test can write two lists that differ, while a projection that had stopped
/// reading that metadata would leave the rule reporting <i>every</i> parameterised endpoint as unbound
/// on the live surface — or, if it read nothing at all, reporting nothing. Driving the same route
/// builder the host drives, and the same projection the catalogue drives, keeps the control honest about
/// the whole path.
/// </para>
/// <para>
/// The three defects are the three positions a template parameter can be left unbound in — first of two,
/// second of two, and the middle of three, which is the shape <c>RemoveParticipant</c> has. The first is
/// the shipped defect itself: a group-supplied leading <c>squadId</c> that no handler bound. Each case
/// carries a <see cref="WellFormed"/> twin at the same route and method whose handler binds every route
/// parameter <i>and</i> a cancellation token, so the control shows the rule discriminating — and shows
/// it tolerating declarations the template does not name — rather than merely objecting to everything.
/// </para>
/// </summary>
/// <param name="Route">The route template the synthesised endpoint is mapped at.</param>
/// <param name="Method">The HTTP method it is mapped for.</param>
/// <param name="DefectName">
/// The name of the defect, used for FsCheck classification and for naming the exhaustive cases.
/// </param>
public sealed record SynthesisedRouteParameterCase(string Route, string Method, string DefectName)
{
    /// <summary>
    /// The shipped defect: a template naming two parameters whose handler binds only the second, as the
    /// six squad-scoped match operations did with their group-supplied <c>squadId</c>.
    /// </summary>
    public const string FirstOfTwoUnbound = "first of two route parameters unbound";

    /// <summary>A template naming two parameters whose handler binds only the first.</summary>
    public const string SecondOfTwoUnbound = "second of two route parameters unbound";

    /// <summary>
    /// A template naming three parameters whose handler binds the outer two — the shape
    /// <c>RemoveParticipant</c> has, and the one in which a missing binding hides most easily.
    /// </summary>
    public const string MiddleOfThreeUnbound = "middle of three route parameters unbound";

    /// <summary>Every defect name, so the exhaustive companion can cover all three by name.</summary>
    public static IReadOnlyList<string> DefectNames =>
    [
        FirstOfTwoUnbound,
        SecondOfTwoUnbound,
        MiddleOfThreeUnbound,
    ];

    // Building a real endpoint compiles a real request delegate, so identical cases — and the generated
    // routes repeat, drawn as they are from a small segment pool — are built once and reused.
    private static readonly ConcurrentDictionary<string, RouteParameterFact> Synthesised = new();

    /// <summary>The parameters this case's route template names, in template order.</summary>
    public IReadOnlyList<string> TemplateParameters => DefectName switch
    {
        FirstOfTwoUnbound or SecondOfTwoUnbound => ["squadId", "matchId"],
        MiddleOfThreeUnbound => ["squadId", "matchId", "membershipId"],
        _ => throw new InvalidOperationException($"Unknown defect '{DefectName}'."),
    };

    /// <summary>
    /// The one parameter the offending handler does not bind — the name the rule's message has to carry
    /// for this case.
    /// </summary>
    public string UnboundParameter => DefectName switch
    {
        FirstOfTwoUnbound => "squadId",
        SecondOfTwoUnbound => "matchId",
        MiddleOfThreeUnbound => "matchId",
        _ => throw new InvalidOperationException($"Unknown defect '{DefectName}'."),
    };

    /// <summary>
    /// The synthesised offending endpoint as the rule sees it — mapped by the real route builder and
    /// projected through the production projection.
    /// </summary>
    public RouteParameterFact Offender => DefectName switch
    {
        // Binds the trailing parameter and leaves the leading one — supplied by the route group in the
        // shipped case — bound by nothing.
        FirstOfTwoUnbound =>
            Project("offender", static (Guid matchId, CancellationToken ct) => Results.NoContent()),

        SecondOfTwoUnbound =>
            Project("offender", static (Guid squadId, CancellationToken ct) => Results.NoContent()),

        MiddleOfThreeUnbound => Project(
            "offender",
            static (Guid squadId, Guid membershipId, CancellationToken ct) => Results.NoContent()),

        _ => throw new InvalidOperationException($"Unknown defect '{DefectName}'."),
    };

    /// <summary>
    /// The same route and method, bound properly: the handler binds every parameter the template names,
    /// plus a cancellation token the template does not. The rule must find nothing wrong with it, or the
    /// control would prove only that it complains indiscriminately.
    /// </summary>
    public RouteParameterFact WellFormed => DefectName switch
    {
        FirstOfTwoUnbound or SecondOfTwoUnbound => Project(
            "well-formed",
            static (Guid squadId, Guid matchId, CancellationToken ct) => Results.NoContent()),

        MiddleOfThreeUnbound => Project(
            "well-formed",
            static (Guid squadId, Guid matchId, Guid membershipId, CancellationToken ct) =>
                Results.NoContent()),

        _ => throw new InvalidOperationException($"Unknown defect '{DefectName}'."),
    };

    /// <summary>
    /// Builds the case for one defect at the given method, interleaving the supplied literal segments
    /// with the defect's parameter segments.
    /// </summary>
    /// <param name="method">The HTTP method.</param>
    /// <param name="defectName">One of <see cref="DefectNames"/>.</param>
    /// <param name="literalSegments">
    /// The literal segments to place before each parameter segment, cycled when there are fewer than
    /// parameters. Literals may repeat; parameter names cannot, which is why they come from the defect.
    /// </param>
    /// <returns>The synthesised case.</returns>
    public static SynthesisedRouteParameterCase For(
        string method,
        string defectName,
        IReadOnlyList<string> literalSegments)
    {
        ArgumentNullException.ThrowIfNull(literalSegments);

        if (!DefectNames.Contains(defectName, StringComparer.Ordinal))
        {
            throw new ArgumentOutOfRangeException(nameof(defectName), defectName, "Unknown defect.");
        }

        var seed = new SynthesisedRouteParameterCase("/synthesised", method, defectName);
        var segments = new List<string> { "synthesised" };

        for (int index = 0; index < seed.TemplateParameters.Count; index++)
        {
            segments.Add(
                literalSegments.Count == 0
                    ? "things"
                    : literalSegments[index % literalSegments.Count]);
            segments.Add($"{{{seed.TemplateParameters[index]}:guid}}");
        }

        return seed with { Route = "/" + string.Join('/', segments) };
    }

    /// <summary>A readable identifier for failure messages and FsCheck classification.</summary>
    public override string ToString() => $"{Method} {Route} — {DefectName}";

    /// <summary>
    /// Maps the handler onto a real route builder at this case's route and method, then projects the
    /// endpoint the framework built.
    /// <para>
    /// The cache key carries the defect and the variant as well as the route and method, because two
    /// cases are deliberately indistinguishable by route: <see cref="FirstOfTwoUnbound"/> and
    /// <see cref="SecondOfTwoUnbound"/> name the same two parameters and differ only in which one the
    /// handler binds. Keying on the route alone would hand the second case the first one's endpoint —
    /// and the property would fail reporting the wrong parameter, which is how this was found.
    /// </para>
    /// </summary>
    private RouteParameterFact Project(string variant, Delegate handler) =>
        Synthesised.GetOrAdd(
            $"{Method} {Route} [{DefectName}/{variant}]",
            _ =>
            {
                using WebApplication app = WebApplication.CreateSlimBuilder().Build();

                app.MapMethods(Route, [Method], handler);

                RouteEndpoint endpoint = ((IEndpointRouteBuilder)app).DataSources
                    .SelectMany(static source => source.Endpoints)
                    .OfType<RouteEndpoint>()
                    .Single();

                return RouteParameterFact.From(endpoint);
            });
}

/// <summary>
/// FsCheck arbitraries for <see cref="SynthesisedRouteParameterCase"/>.
/// <para>
/// The defect fixes the parameter <i>names</i> — they have to match the real handler's parameter names,
/// because the whole point of the control is that the framework does the binding — so what is generated
/// is everything else: the method, and the literal segments the parameters are interleaved with. That is
/// enough for the naming conjunct of the property to be a statement about the rule's message
/// construction rather than about one hard-coded route. Every generated route begins
/// <c>/synthesised</c>, so none can be mistaken for a mapped one.
/// </para>
/// </summary>
public static class SynthesisedRouteParameterCaseGenerators
{
    private static readonly string[] Literals =
    [
        "squads",
        "matches",
        "participants",
        "widgets",
        "things",
    ];

    private static readonly string[] Methods = ["GET", "POST", "PUT", "PATCH", "DELETE"];

    /// <summary>Arbitrary for a single synthesised route-parameter case.</summary>
    /// <returns>The arbitrary.</returns>
    public static Arbitrary<SynthesisedRouteParameterCase> SynthesisedRouteParameterCase() =>
        Arb.From(
            from defect in Gen.Elements(Contracts.SynthesisedRouteParameterCase.DefectNames.ToArray())
            from method in Gen.Elements(Methods)
            from literalCount in Gen.Choose(1, 3)
            from literals in Gen.ArrayOf(Gen.Elements(Literals), literalCount)
            select Contracts.SynthesisedRouteParameterCase.For(method, defect, literals));
}
