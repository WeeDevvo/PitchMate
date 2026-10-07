using Microsoft.AspNetCore.Http.Metadata;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using PitchMate.Api.Tests.Auth;

namespace PitchMate.Api.Tests.Contracts;

/// <summary>
/// Boots the real Api once and asks it what it mapped.
/// <para>
/// The endpoints come from the host's own <see cref="EndpointDataSource"/> — the same object routing
/// matches requests against — rather than from a list kept in the test (Requirement 3.1). That is the
/// whole point of the guard this fixture feeds: a route added in a hurry next year enters the
/// assertions because it entered the router, with no test edited and no list to forget. A guard built
/// over a hand-maintained inventory would pass for exactly as long as someone remembered to extend the
/// inventory, which is the failure mode being designed out.
/// </para>
/// <para>
/// Endpoints marked as excluded from the API description are dropped, because they are not operations
/// of the committed document: the only one is the OpenAPI document route itself, which
/// <c>MapOpenApi()</c> maps with <c>ExcludeFromDescription()</c> and which exists only in a development
/// host. Dropping it on the framework's own flag keeps the filter from becoming a second
/// hand-maintained list.
/// </para>
/// </summary>
public sealed class MappedEndpointCatalogue : IDisposable
{
    private readonly AuthApiFactory _factory = new();

    /// <summary>
    /// Enumerates the mapped endpoints from the running host, ordered by route then method so failure
    /// output reads in a stable order across runs.
    /// </summary>
    public MappedEndpointCatalogue()
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
                .Select(MappedEndpoint.From)
                .OrderBy(static endpoint => endpoint.Route, StringComparer.Ordinal)
                .ThenBy(static endpoint => endpoint.Method, StringComparer.Ordinal),
        ];
    }

    /// <summary>Every endpoint the running host reports as an operation of the surface.</summary>
    public IReadOnlyList<MappedEndpoint> Endpoints { get; }

    /// <inheritdoc />
    public void Dispose() => _factory.Dispose();
}
