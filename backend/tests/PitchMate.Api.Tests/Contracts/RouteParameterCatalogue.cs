using Microsoft.AspNetCore.Http.Metadata;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using PitchMate.Api.Tests.Auth;

namespace PitchMate.Api.Tests.Contracts;

/// <summary>
/// Boots the real Api once and asks it which parameters each mapped endpoint names and which it binds.
/// <para>
/// The endpoints come from the host's own <see cref="EndpointDataSource"/> — the same object routing
/// matches requests against — rather than from a list kept in the test, exactly as
/// <see cref="MappedEndpointCatalogue"/> does and for the same reason: the six unreachable operations
/// this chore corrects were unreachable for a year because nothing enumerated the mapped surface and
/// compared it to what the handlers bound. A guard over a hand-maintained inventory would have had the
/// same blind spot.
/// </para>
/// <para>
/// This is a second projection of the same discovered set rather than a widening of
/// <see cref="MappedEndpoint"/>, because the two guards reason about different facts —
/// <see cref="MappedEndpoint"/> about declared responses and authorisation, this about parameters — and
/// the shared types of this folder are read by several properties each. The
/// <see cref="ConcealingEndpointCatalogue"/> is the precedent.
/// </para>
/// <para>
/// Endpoints marked as excluded from the API description are dropped, because they are not operations
/// of the committed document: the only one is the OpenAPI document route itself, which
/// <c>MapOpenApi()</c> maps with <c>ExcludeFromDescription()</c>. Dropping it on the framework's own
/// flag keeps the filter from becoming a second hand-maintained list.
/// </para>
/// </summary>
public sealed class RouteParameterCatalogue : IDisposable
{
    private readonly AuthApiFactory _factory = new();

    /// <summary>
    /// Enumerates the mapped endpoints from the running host, ordered by route then method so failure
    /// output reads in a stable order across runs.
    /// </summary>
    public RouteParameterCatalogue()
    {
        // Resolving from the factory's provider boots the real host, so the endpoints below are the
        // ones Program.cs actually mapped, through the real composition roots.
        var dataSource = _factory.Services.GetRequiredService<EndpointDataSource>();

        Endpoints =
        [
            .. dataSource.Endpoints
                .OfType<RouteEndpoint>()
                .Where(static endpoint =>
                    endpoint.Metadata.GetMetadata<IExcludeFromDescriptionMetadata>()
                        ?.ExcludeFromDescription != true)
                .Select(RouteParameterFact.From)
                .OrderBy(static endpoint => endpoint.Route, StringComparer.Ordinal)
                .ThenBy(static endpoint => endpoint.Method, StringComparer.Ordinal),
        ];
    }

    /// <summary>Every endpoint the running host reports as an operation of the surface.</summary>
    public IReadOnlyList<RouteParameterFact> Endpoints { get; }

    /// <summary>The endpoints whose route template names at least one parameter.</summary>
    public IReadOnlyList<RouteParameterFact> ParameterisedEndpoints =>
        [.. Endpoints.Where(static endpoint => endpoint.RoutePatternParameters.Count > 0)];

    /// <inheritdoc />
    public void Dispose() => _factory.Dispose();
}
