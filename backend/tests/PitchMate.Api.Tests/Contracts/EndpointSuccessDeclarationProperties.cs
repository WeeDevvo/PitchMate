using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;

namespace PitchMate.Api.Tests.Contracts;

/// <summary>
/// <b>Property 1 — Every mapped endpoint declares its success response.</b>
/// <para>
/// <b>Validates: Requirements 1.1, 1.2, 1.3, 1.6, 3.2, 3.8</b>
/// </para>
/// <para>
/// The property has two halves, and they answer different questions.
/// </para>
/// <para>
/// The <b>exhaustive half</b> quantifies over the endpoints the running host reports — not a list in
/// the test (Requirement 3.1) — and applies <see cref="SuccessDeclarationRule"/> to every one of them:
/// each declares a 2xx, each body-bearing 2xx names its response contract, and each <c>204</c> names
/// none (Requirements 1.1, 1.2, 1.3, 1.6). Because the surface is a finite discovered set, exhausting
/// it is strictly stronger than sampling it, which is why this half is a theory over the real
/// catalogue rather than an FsCheck generator. It is floored at 67 endpoints
/// (<see cref="TheQuantifiedSurfaceIsNonVacuousAndDeclaredThroughout"/>, Requirement 3.8) so a
/// discovery regression fails here instead of passing over an empty set — the one way an exhaustive
/// check over a discovered set can go quietly green.
/// </para>
/// <para>
/// The <b>discriminating half</b> is the part that earns the property. On its own, the exhaustive half
/// re-states what the declaration pass already made green; a rule that returned no violations for
/// <i>anything</i> would satisfy it just as well. So the rule is also applied to endpoints that are
/// synthesised precisely to break it (<see cref="SynthesisedEndpointCase"/>) — a bare endpoint, a
/// <c>200</c> declared without a body type, and a <c>204</c> declared with one — and the rule must
/// report each, in a message naming <i>that</i> route and <i>that</i> method rather than merely
/// objecting in general (Requirement 3.2). Each synthesised case is paired with a well-formed twin at
/// the same route and method which must be reported clean, so the control shows the rule
/// discriminating instead of complaining indiscriminately.
/// </para>
/// <para>
/// Both halves call the same predicate. The rule lives in <see cref="SuccessDeclarationRule"/> and the
/// Endpoint_Metadata_Guard
/// (<see cref="EndpointMetadataGuardTests.EveryMappedEndpointDeclaresItsSuccessResponse"/>) calls it
/// too, so this property proves the teeth of the rule the production guard actually applies — not of a
/// second copy that could drift loose while the guard stayed green.
/// </para>
/// </summary>
public sealed class EndpointSuccessDeclarationProperties : IClassFixture<MappedEndpointCatalogue>
{
    /// <summary>
    /// The non-vacuity floor (Requirement 3.8): the 66 operations of the pre-change document plus
    /// <c>GET /auth/me</c>.
    /// </summary>
    private const int MinimumMappedEndpointCount = 67;

    private readonly MappedEndpointCatalogue _catalogue;

    /// <summary>Receives the shared catalogue of endpoints read off the running host.</summary>
    /// <param name="catalogue">The discovered endpoint catalogue.</param>
    public EndpointSuccessDeclarationProperties(MappedEndpointCatalogue catalogue)
    {
        ArgumentNullException.ThrowIfNull(catalogue);

        _catalogue = catalogue;
    }

    /// <summary>
    /// Every way Requirement 3.2's rule can be broken, named individually for the exhaustive
    /// companion below.
    /// </summary>
    /// <returns>One case per defect.</returns>
    public static TheoryData<string> AllDefects()
    {
        var data = new TheoryData<string>();

        foreach (string defectName in SynthesisedEndpointCase.DefectNames)
        {
            data.Add(defectName);
        }

        return data;
    }

    // Feature: api-response-contracts, Property 1: Every mapped endpoint declares its success response.
    // Validates: Requirements 1.1, 1.2, 1.3, 1.6, 3.2
    /// <summary>
    /// The exhaustive half: every endpoint the host mapped satisfies the rule. Quantified over the
    /// discovered set, so an endpoint mapped next year enters this assertion without the test being
    /// edited.
    /// </summary>
    [Fact]
    public void Property1_EveryEndpointTheHostReportsDeclaresItsSuccessResponse()
    {
        IReadOnlyList<string> violations = SuccessDeclarationRule.Violations(_catalogue.Endpoints);

        Assert.True(
            violations.Count == 0,
            $"{violations.Count} endpoints do not declare their success response:{Environment.NewLine}"
                + string.Join(Environment.NewLine, violations.Select(static v => $"  - {v}")));
    }

    // Feature: api-response-contracts, Property 1: Every mapped endpoint declares its success response.
    // Validates: Requirements 1.1, 1.2, 1.3, 1.6, 3.2
    /// <summary>
    /// The discriminating half, over arbitrary routes and methods: an endpoint that breaks the rule is
    /// reported, the report names that endpoint's route and method, and a well-formed endpoint at the
    /// same route and method is reported clean.
    /// <para>
    /// The route and method are generated rather than fixed so the naming conjunct is a statement about
    /// the rule's message construction — it names whatever endpoint it was handed — rather than a
    /// coincidence of one hard-coded string.
    /// </para>
    /// </summary>
    /// <param name="synthesised">The synthesised defective endpoint and its well-formed twin.</param>
    /// <returns>The property.</returns>
    [Property(MaxTest = 300, Arbitrary = new[] { typeof(SynthesisedEndpointCaseGenerators) })]
    public Property Property1_AnEndpointLackingItsDeclarationIsReportedByRouteAndMethod(
        SynthesisedEndpointCase synthesised)
    {
        ArgumentNullException.ThrowIfNull(synthesised);

        IReadOnlyList<string> reported = SuccessDeclarationRule.Violations(synthesised.Defective);
        IReadOnlyList<string> twin = SuccessDeclarationRule.Violations(synthesised.WellFormed);

        bool failsNamingTheEndpoint = reported.Count > 0
            && reported.All(message =>
                message.Contains(synthesised.Route, StringComparison.Ordinal)
                    && message.Contains(synthesised.Method, StringComparison.Ordinal));

        return (failsNamingTheEndpoint && twin.Count == 0)
            .ToProperty()
            .Label(
                $"{synthesised}: reported [{string.Join(" | ", reported)}]; "
                    + $"well-formed twin reported [{string.Join(" | ", twin)}]")
            .Collect(synthesised.DefectName);
    }

    /// <summary>
    /// The exhaustive companion to the discriminating half: all three ways the rule can be broken,
    /// named individually so a failure identifies the defect rather than a shrunk counterexample.
    /// <para>
    /// A <c>200</c> with no body type and a <c>204</c> with one are the second half of Requirement
    /// 3.2 — the declarations that look present and still generate as <c>unknown</c>, or promise a body
    /// that will never be written — and each must be reported, named, and distinguished from the
    /// well-formed twin at the same route.
    /// </para>
    /// </summary>
    /// <param name="defectName">The defect under test.</param>
    [Theory]
    [MemberData(nameof(AllDefects))]
    public void EachWayOfBreakingTheRuleIsReportedNamingTheRouteAndMethod(string defectName)
    {
        SynthesisedEndpointCase synthesised =
            SynthesisedEndpointCase.For("/synthesised/{id:guid}/thing", "PATCH", defectName);

        IReadOnlyList<string> reported = SuccessDeclarationRule.Violations(synthesised.Defective);

        Assert.NotEmpty(reported);
        Assert.All(reported, message =>
        {
            Assert.Contains(synthesised.Route, message, StringComparison.Ordinal);
            Assert.Contains(synthesised.Method, message, StringComparison.Ordinal);
        });

        // The rule discriminates: the same route and method, declared properly, is reported clean.
        Assert.Empty(SuccessDeclarationRule.Violations(synthesised.WellFormed));
    }

    /// <summary>
    /// Requirements 1.1 and 3.8 — the floor under the exhaustive half.
    /// <para>
    /// At least 67 endpoints were quantified over; every one of them was described well enough to judge
    /// (a route and a concrete method, which is what the rule's message names); and every one declares
    /// at least one success. Without this, the exhaustive half would be satisfied by the empty set —
    /// which is exactly what a change to endpoint discovery produces, and it would go green at the
    /// moment it stopped looking at anything.
    /// </para>
    /// </summary>
    [Fact]
    public void TheQuantifiedSurfaceIsNonVacuousAndDeclaredThroughout()
    {
        Assert.True(
            _catalogue.Endpoints.Count >= MinimumMappedEndpointCount,
            $"Endpoint discovery found {_catalogue.Endpoints.Count} endpoints; "
                + $"at least {MinimumMappedEndpointCount} are mapped. "
                + "A property quantified over nothing holds for everything.");

        Assert.All(_catalogue.Endpoints, endpoint =>
        {
            Assert.StartsWith("/", endpoint.Route, StringComparison.Ordinal);
            Assert.NotEqual("(any)", endpoint.Method);
            Assert.NotEmpty(endpoint.DeclaredSuccessResponses);
        });
    }
}

/// <summary>
/// FsCheck arbitraries for <see cref="SynthesisedEndpointCase"/>.
/// <para>
/// Routes are assembled from literal and parameterised segments and methods are drawn from the verbs
/// the surface actually uses, so the generated endpoint is a plausible route rather than a string — it
/// has to parse as a route pattern, because the case builds a real <see cref="Microsoft.AspNetCore.Routing.RouteEndpoint"/>
/// from it. The defect is drawn from the three ways Requirement 3.2's rule can be broken.
/// </para>
/// </summary>
public static class SynthesisedEndpointCaseGenerators
{
    private static readonly string[] RouteSegments =
    [
        "synthesised",
        "widgets",
        "squads",
        "matches",
        "notifications",
        "{id:guid}",
        "{slug}",
    ];

    private static readonly string[] Methods = ["GET", "POST", "PUT", "PATCH", "DELETE"];

    /// <summary>Arbitrary for a single synthesised endpoint case.</summary>
    /// <returns>The arbitrary.</returns>
    public static Arbitrary<SynthesisedEndpointCase> SynthesisedEndpointCase() =>
        Arb.From(
            from segmentCount in Gen.Choose(0, 4)
            from segments in Gen.ArrayOf(Gen.Elements(RouteSegments), segmentCount)
            from method in Gen.Elements(Methods)
            from defect in Gen.Elements(Contracts.SynthesisedEndpointCase.DefectNames.ToArray())
            select Contracts.SynthesisedEndpointCase.For(Route(segments), method, defect));

    /// <summary>
    /// Assembles a parseable route from the generated segments. A route pattern rejects a repeated
    /// parameter name, so a parameter segment is taken at most once; literals may repeat freely. The
    /// leading literal keeps every generated route non-empty.
    /// </summary>
    private static string Route(IReadOnlyList<string> segments)
    {
        var taken = new List<string> { "synthesised" };

        foreach (string segment in segments)
        {
            bool isParameter = segment.StartsWith('{');

            if (isParameter && taken.Contains(segment, StringComparer.Ordinal))
            {
                continue;
            }

            taken.Add(segment);
        }

        return "/" + string.Join('/', taken);
    }
}
