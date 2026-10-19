using Microsoft.AspNetCore.Http.Metadata;
using Microsoft.AspNetCore.Routing;

namespace PitchMate.Api.Tests.Contracts;

/// <summary>
/// One operation reduced to the two parameter sets the route-parameter rule compares: the parameters
/// its route template <i>names</i>, and the parameters it <i>declares</i>.
/// <para>
/// The same shape describes an operation seen two ways, which is the point. Read off a
/// <see cref="RouteEndpoint"/> (<see cref="From(RouteEndpoint)"/>) the declared set is the framework's
/// own <see cref="IParameterBindingMetadata"/> — what the route handler actually binds. Read off the
/// emitted OpenAPI document (<see cref="RouteParameterRule.MatchOperationsOf"/>) the declared set is
/// the operation's <c>required</c> path parameters — what a generated client will require a caller to
/// supply. One rule then judges both, so the two cannot disagree about what "declared" means.
/// </para>
/// <para>
/// Both sets are read rather than restated, so an operation mapped next year arrives fully described
/// without this type being edited.
/// </para>
/// </summary>
/// <param name="Route">The route template, exactly as mapped or as the document keys it.</param>
/// <param name="Method">The HTTP method, or the methods joined when a route is mapped for several.</param>
/// <param name="Subject">
/// What a declaration <i>is</i> for this reading — <see cref="BindingMetadata"/> for a mapped endpoint,
/// <see cref="RequiredPathParameter"/> for a document operation. It appears in the failure message, so
/// an offender names the artefact the fix belongs in.
/// </param>
/// <param name="RoutePatternParameters">Every parameter the route template names, in template order.</param>
/// <param name="DeclaredParameters">Every parameter the operation declares.</param>
public sealed record RouteParameterFact(
    string Route,
    string Method,
    string Subject,
    IReadOnlyList<string> RoutePatternParameters,
    IReadOnlyList<string> DeclaredParameters)
{
    /// <summary>The declaration a mapped endpoint makes: a parameter its handler binds.</summary>
    public const string BindingMetadata = "bound parameter";

    /// <summary>The declaration a document operation makes: a required path parameter.</summary>
    public const string RequiredPathParameter = "required path parameter";

    /// <summary>
    /// The route and method, which is what a failure message has to name for the offending operation to
    /// be findable in the source or the document (Requirement 7.5).
    /// </summary>
    public string Description => $"{Method} {Route}";

    /// <summary>
    /// Whether the operation declares a parameter for the given route-template parameter. Matched
    /// case-insensitively because route-value binding is, so an endpoint binding <c>SquadId</c> against
    /// a <c>{squadId}</c> template is reachable and must not be reported.
    /// </summary>
    /// <param name="routeParameterName">The route-template parameter to look for.</param>
    /// <returns><see langword="true"/> when a declaration carries that name.</returns>
    public bool Declares(string routeParameterName) =>
        DeclaredParameters.Contains(routeParameterName, StringComparer.OrdinalIgnoreCase);

    /// <summary>A readable form for failure messages, listing both sets.</summary>
    public override string ToString() =>
        $"{Description} names [{string.Join(", ", RoutePatternParameters)}] "
            + $"and declares [{string.Join(", ", DeclaredParameters)}]";

    /// <summary>
    /// Projects one route endpoint of the running host into the two sets above.
    /// <para>
    /// The declared set comes from <see cref="IParameterBindingMetadata"/>, which the framework leaves
    /// on an endpoint built from a route-handler delegate — one entry per handler parameter, named as
    /// the parameter is named. It therefore includes the handler's services, its
    /// <see cref="System.Security.Claims.ClaimsPrincipal"/>, its body and its cancellation token
    /// alongside its route values, which is harmless: the rule only ever asks whether a <i>route</i>
    /// parameter appears among them, never the converse.
    /// </para>
    /// </summary>
    /// <param name="endpoint">The route endpoint to project.</param>
    /// <returns>The projected operation.</returns>
    public static RouteParameterFact From(RouteEndpoint endpoint)
    {
        ArgumentNullException.ThrowIfNull(endpoint);

        IReadOnlyList<string> methods =
            endpoint.Metadata.GetMetadata<IHttpMethodMetadata>()?.HttpMethods ?? [];

        return new RouteParameterFact(
            endpoint.RoutePattern.RawText ?? endpoint.DisplayName ?? "(unnamed route)",
            methods.Count == 0 ? "(any)" : string.Join("+", methods.Order(StringComparer.Ordinal)),
            BindingMetadata,
            [.. endpoint.RoutePattern.Parameters.Select(static parameter => parameter.Name)],
            [
                .. endpoint.Metadata
                    .GetOrderedMetadata<IParameterBindingMetadata>()
                    .Select(static parameter => parameter.Name),
            ]);
    }
}
