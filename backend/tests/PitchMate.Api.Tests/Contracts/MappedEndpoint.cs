using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Metadata;
using Microsoft.AspNetCore.Routing;

namespace PitchMate.Api.Tests.Contracts;

/// <summary>
/// One route-and-method pair as the running host reports it, reduced to the facts the
/// endpoint-metadata guard reasons about: what it is, whether it is guarded, and what it declares.
/// <para>
/// Everything here is read off <see cref="RouteEndpoint"/> metadata rather than restated by the test,
/// so an endpoint mapped next year arrives fully described without this type being edited
/// (Requirement 3.1).
/// </para>
/// </summary>
/// <param name="Route">The raw route pattern, exactly as mapped.</param>
/// <param name="Method">The HTTP method, or the methods joined when a route is mapped for several.</param>
/// <param name="RequiresAuthorization">Whether the endpoint is guarded by <c>RequireAuthorization()</c>.</param>
/// <param name="DeclaredResponses">Every response the endpoint declares as metadata.</param>
public sealed record MappedEndpoint(
    string Route,
    string Method,
    bool RequiresAuthorization,
    IReadOnlyList<DeclaredResponse> DeclaredResponses)
{
    /// <summary>
    /// The route and method, which is what a failure message has to name for the offending endpoint to
    /// be findable in the source (Requirements 3.2, 3.3).
    /// </summary>
    public string Description => $"{Method} {Route}";

    /// <summary>Whether the endpoint is reachable without an access token.</summary>
    public bool IsAnonymous => !RequiresAuthorization;

    /// <summary>The success responses the endpoint declares.</summary>
    public IReadOnlyList<DeclaredResponse> DeclaredSuccessResponses =>
        [.. DeclaredResponses.Where(static response => response.IsSuccess)];

    /// <summary>Whether the endpoint declares the given status.</summary>
    /// <param name="status">The status to look for.</param>
    /// <returns><see langword="true"/> when that status is declared.</returns>
    public bool Declares(int status) =>
        DeclaredResponses.Any(response => response.Status == status);

    /// <summary>A readable form for failure messages, listing what the endpoint declares.</summary>
    public override string ToString() =>
        DeclaredResponses.Count == 0
            ? $"{Description} declares nothing"
            : $"{Description} declares {string.Join(", ", DeclaredResponses.Select(static r => r.ToString()))}";

    /// <summary>
    /// Projects one route endpoint of the running host into the facts above.
    /// <para>
    /// Authorisation is read as the framework decides it: <c>RequireAuthorization()</c> leaves
    /// <see cref="IAuthorizeData"/> on the endpoint, and <c>AllowAnonymous()</c> leaves
    /// <see cref="IAllowAnonymousMetadata"/> which wins over it. Reading both is what keeps the
    /// <c>401</c> correspondence an observation about the real pipeline rather than about a naming
    /// convention.
    /// </para>
    /// </summary>
    /// <param name="endpoint">The route endpoint to project.</param>
    /// <returns>The projected endpoint.</returns>
    public static MappedEndpoint From(RouteEndpoint endpoint)
    {
        ArgumentNullException.ThrowIfNull(endpoint);

        bool guarded = endpoint.Metadata.GetOrderedMetadata<IAuthorizeData>().Count > 0
            && endpoint.Metadata.GetOrderedMetadata<IAllowAnonymous>().Count == 0;

        IReadOnlyList<string> methods =
            endpoint.Metadata.GetMetadata<IHttpMethodMetadata>()?.HttpMethods ?? [];

        IReadOnlyList<DeclaredResponse> declared =
        [
            .. endpoint.Metadata
                .GetOrderedMetadata<IProducesResponseTypeMetadata>()
                .Select(static metadata => new DeclaredResponse(
                    metadata.StatusCode,
                    metadata.Type is null || metadata.Type == typeof(void) ? null : metadata.Type))
                .OrderBy(static response => response.Status),
        ];

        return new MappedEndpoint(
            endpoint.RoutePattern.RawText ?? endpoint.DisplayName ?? "(unnamed route)",
            methods.Count == 0 ? "(any)" : string.Join("+", methods.Order(StringComparer.Ordinal)),
            guarded,
            declared);
    }
}
