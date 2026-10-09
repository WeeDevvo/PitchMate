using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.Routing.Patterns;

namespace PitchMate.Api.Tests.Contracts;

/// <summary>
/// An endpoint that was never mapped: a real <see cref="RouteEndpoint"/>, built in the test with
/// deliberately defective response metadata, so the success-declaration rule can be shown to
/// <i>reject</i> something.
/// <para>
/// This is the substance of Property 1. Applying the rule to the live surface re-asserts what the
/// declaration pass already made green; it cannot distinguish a rule with teeth from a rule that
/// returns no violations for anything. The discriminating half needs an endpoint that breaks the rule,
/// and since the surface has none by construction, one is synthesised here.
/// </para>
/// <para>
/// It is synthesised as a genuine <see cref="RouteEndpoint"/> carrying genuine
/// <see cref="ProducesResponseTypeMetadata"/> and projected through the production
/// <see cref="MappedEndpoint.From(RouteEndpoint)"/>, not hand-built as a <see cref="MappedEndpoint"/>
/// literal. That matters: the rule reads <see cref="MappedEndpoint.DeclaredSuccessResponses"/>, which
/// is the output of that projection, so a projection that lost a declaration would make the guard
/// vacuous on the live surface while a hand-built literal sailed past. Driving the same projection the
/// catalogue drives keeps the control honest about the whole path, metadata reading included.
/// </para>
/// <para>
/// The three defects are the three ways Requirement 3.2's rule can be broken — the bare endpoint, the
/// body-bearing success with no contract, and the valueless success that declares one — and each case
/// carries a <see cref="WellFormed"/> twin at the same route and method, so the control shows the rule
/// discriminating rather than merely objecting to everything.
/// </para>
/// </summary>
/// <param name="Route">The route pattern the synthesised endpoint is mapped at.</param>
/// <param name="Method">The HTTP method it is mapped for.</param>
/// <param name="DefectName">
/// The name of the defect, used for FsCheck classification and for naming the exhaustive cases.
/// </param>
/// <param name="DefectiveDeclarations">
/// The response metadata that breaks the rule — the point of the case.
/// </param>
public sealed record SynthesisedEndpointCase(
    string Route,
    string Method,
    string DefectName,
    IReadOnlyList<DeclaredResponse> DefectiveDeclarations)
{
    /// <summary>The bare endpoint: problem statuses declared, no success at all.</summary>
    public const string NoSuccessDeclared = "no 2xx declared";

    /// <summary>A <c>200</c> declared with no response contract, so the client still sees nothing.</summary>
    public const string BodyBearingSuccessWithoutAContract = "200 declared without a body type";

    /// <summary>A <c>204</c> declared with a body type, the same mistake inverted.</summary>
    public const string ValuelessSuccessDeclaringABody = "204 declared with a body type";

    /// <summary>Every defect name, so the exhaustive companion can cover all three by name.</summary>
    public static IReadOnlyList<string> DefectNames =>
    [
        NoSuccessDeclared,
        BodyBearingSuccessWithoutAContract,
        ValuelessSuccessDeclaringABody,
    ];

    /// <summary>
    /// The synthesised endpoint as the rule sees it — projected from a real route endpoint through the
    /// production projection.
    /// </summary>
    public MappedEndpoint Defective => Project(DefectiveDeclarations);

    /// <summary>
    /// The same route and method, declared properly. The rule must find nothing wrong with this one, or
    /// the control above would prove only that the rule complains indiscriminately.
    /// </summary>
    public MappedEndpoint WellFormed => Project(
    [
        new DeclaredResponse(StatusCodes.Status200OK, typeof(string)),
        new DeclaredResponse(StatusCodes.Status400BadRequest, typeof(string)),
    ]);

    /// <summary>
    /// Builds the case for one defect at the given route and method.
    /// </summary>
    /// <param name="route">The route pattern.</param>
    /// <param name="method">The HTTP method.</param>
    /// <param name="defectName">One of <see cref="DefectNames"/>.</param>
    /// <returns>The synthesised case.</returns>
    public static SynthesisedEndpointCase For(string route, string method, string defectName)
    {
        IReadOnlyList<DeclaredResponse> declarations = defectName switch
        {
            // Declares problem statuses but no success: the shape a route mapped with nothing but
            // .WithName(...) and a problem convention would have.
            NoSuccessDeclared =>
            [
                new DeclaredResponse(StatusCodes.Status400BadRequest, typeof(string)),
                new DeclaredResponse(StatusCodes.Status404NotFound, typeof(string)),
            ],

            // The declaration that looks present and types the body as nothing — what all 66 operations
            // of the pre-change document said.
            BodyBearingSuccessWithoutAContract =>
            [
                new DeclaredResponse(StatusCodes.Status200OK, null),
                new DeclaredResponse(StatusCodes.Status400BadRequest, typeof(string)),
            ],

            // A valueless success promising a body it will never write.
            ValuelessSuccessDeclaringABody =>
            [
                new DeclaredResponse(StatusCodes.Status204NoContent, typeof(string)),
                new DeclaredResponse(StatusCodes.Status400BadRequest, typeof(string)),
            ],

            _ => throw new ArgumentOutOfRangeException(nameof(defectName), defectName, "Unknown defect."),
        };

        return new SynthesisedEndpointCase(route, method, defectName, declarations);
    }

    /// <summary>A readable identifier for failure messages and FsCheck classification.</summary>
    public override string ToString() => $"{Method} {Route} — {DefectName}";

    private MappedEndpoint Project(IReadOnlyList<DeclaredResponse> declarations)
    {
        List<object> metadata = [new HttpMethodMetadata([Method])];

        metadata.AddRange(
            declarations.Select(
                declaration => new ProducesResponseTypeMetadata(declaration.Status, declaration.BodyType)));

        var endpoint = new RouteEndpoint(
            static _ => Task.CompletedTask,
            RoutePatternFactory.Parse(Route),
            order: 0,
            new EndpointMetadataCollection(metadata),
            $"{Method} {Route}");

        return MappedEndpoint.From(endpoint);
    }
}
