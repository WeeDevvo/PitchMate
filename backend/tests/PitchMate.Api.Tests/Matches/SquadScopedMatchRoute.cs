using Microsoft.AspNetCore.Http.Metadata;
using Microsoft.AspNetCore.Routing;

namespace PitchMate.Api.Tests.Matches;

/// <summary>
/// One of the ten operations as the running host actually mapped it: its HTTP method, its route template,
/// and every parameter that template names.
/// <para>
/// The template is <b>read off the host's own <see cref="EndpointDataSource"/></b> rather than written
/// here, for the same reason the route-parameter guard of task 2.5 does: a URL restated in a test is a
/// second source of truth, and the defect this chore corrects — six route segments nothing bound — is
/// exactly the kind that survives when a test asserts against its own copy of the surface. Building each
/// request by substituting <em>every</em> parameter the discovered template names is also the end-to-end
/// proof Requirement 13.17 asks for: a generated client that supplies all declared path values reaches
/// the operation.
/// </para>
/// </summary>
/// <param name="Operation">The operation this route belongs to.</param>
/// <param name="Method">The single HTTP method the endpoint is mapped for.</param>
/// <param name="Template">The route template exactly as mapped, constraints included.</param>
/// <param name="Parameters">Every parameter the template names, in template order.</param>
public sealed record SquadScopedMatchRoute(
    SquadScopedMatchOperation Operation,
    string Method,
    string Template,
    IReadOnlyList<string> Parameters)
{
    /// <summary>A readable form for failure messages.</summary>
    public override string ToString() => $"{Method} {Template}";

    /// <summary>
    /// Finds each of the ten operations on the running host by the name its <c>WithName(...)</c> declares.
    /// </summary>
    /// <param name="endpoints">The running host's endpoint data source.</param>
    /// <returns>One route per operation found, in enum order; an operation not found is simply absent, which the non-vacuity floor reports.</returns>
    public static IReadOnlyList<SquadScopedMatchRoute> DiscoverFrom(EndpointDataSource endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        Dictionary<string, RouteEndpoint> byName = endpoints.Endpoints
            .OfType<RouteEndpoint>()
            .Select(static endpoint => (
                Name: endpoint.Metadata.GetMetadata<IEndpointNameMetadata>()?.EndpointName,
                Endpoint: endpoint))
            .Where(static named => named.Name is not null)
            .ToDictionary(
                static named => named.Name!,
                static named => named.Endpoint,
                StringComparer.Ordinal);

        var routes = new List<SquadScopedMatchRoute>();

        foreach (SquadScopedMatchOperation operation in Enum.GetValues<SquadScopedMatchOperation>())
        {
            if (!byName.TryGetValue(operation.ToString(), out RouteEndpoint? endpoint))
            {
                continue;
            }

            IReadOnlyList<string> methods =
                endpoint.Metadata.GetMetadata<IHttpMethodMetadata>()?.HttpMethods ?? [];

            routes.Add(new SquadScopedMatchRoute(
                operation,
                methods.Count == 1 ? methods[0] : string.Join("+", methods.Order(StringComparer.Ordinal)),
                endpoint.RoutePattern.RawText ?? "(unnamed route)",
                [.. endpoint.RoutePattern.Parameters.Select(static parameter => parameter.Name)]));
        }

        return routes;
    }

    /// <summary>
    /// Builds a concrete request path by substituting <paramref name="values"/> into the template.
    /// <para>
    /// A parameter the template names for which no value was supplied throws rather than being left as a
    /// literal <c>{name}</c> segment. That is deliberate: a silently unsubstituted segment would route to
    /// nothing and answer <c>404</c>, which for the one concealing operation of the ten is
    /// indistinguishable from the refusal under test — the property would pass having proved nothing.
    /// </para>
    /// </summary>
    /// <param name="values">A value per template parameter, keyed by parameter name (case-insensitive).</param>
    /// <returns>The request path, leading slash included.</returns>
    public string BuildPath(IReadOnlyDictionary<string, string> values)
    {
        ArgumentNullException.ThrowIfNull(values);

        string path = Template;

        foreach (string parameter in Parameters)
        {
            if (!values.TryGetValue(parameter, out string? value))
            {
                throw new InvalidOperationException(
                    $"{this} names route parameter '{parameter}' but the request supplied no value for "
                        + "it; an unsubstituted segment would be routed as a different request.");
            }

            path = Replace(path, parameter, value);
        }

        return path.StartsWith('/') ? path : "/" + path;
    }

    /// <summary>
    /// Replaces the <c>{name}</c> or <c>{name:constraint}</c> placeholder for one parameter, so the
    /// route constraints the templates carry (<c>:guid</c> on all three of them) do not have to be
    /// stripped first.
    /// </summary>
    private static string Replace(string path, string parameter, string value)
    {
        int open = path.IndexOf('{' + parameter, StringComparison.OrdinalIgnoreCase);

        if (open < 0)
        {
            return path;
        }

        int close = path.IndexOf('}', open);

        return close < 0 ? path : path[..open] + value + path[(close + 1)..];
    }
}
