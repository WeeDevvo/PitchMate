using Microsoft.AspNetCore.Http;

namespace PitchMate.Api.Tests.Contracts;

/// <summary>
/// The two authorisation-declaration rules of Requirements 3.3, 3.4 and 2.9, each as a single
/// predicate over one <see cref="MappedEndpoint"/>.
/// <para>
/// <b>Validates: Requirements 2.8, 2.9, 3.3, 3.4, 5.4</b>
/// </para>
/// <para>
/// The rules live here, on their own, for the reason <see cref="SuccessDeclarationRule"/> does: two
/// tests apply them, and a rule applied twice is a rule that can be satisfied twice differently. The
/// Endpoint_Metadata_Guard
/// (<see cref="EndpointMetadataGuardTests.EveryAuthorisedEndpointDeclaresUnauthorized"/> and
/// <see cref="EndpointMetadataGuardTests.NoAnonymousEndpointDeclaresAnAuthorisationStatus"/>) applies
/// them to the endpoints the running host reports; Property 2
/// (<see cref="AuthorizationDeclarationProperties"/>) applies them to those same endpoints <i>and</i>
/// to synthesised endpoints that deliberately break them, in order to show they have teeth. Had the
/// property re-expressed the rules in its own words, the looser copy would have been the one that
/// stayed green.
/// </para>
/// <para>
/// There are two rules, and they are converses of one another:
/// </para>
/// <list type="bullet">
/// <item><b>The <c>401</c> correspondence</b>
/// (<see cref="AuthorisedEndpointsMissingUnauthorized(IEnumerable{MappedEndpoint}, IReadOnlyList{string})"/>) —
/// a guarded endpoint declares <c>401</c>, unless its route is one of the explicitly listed stats
/// routes, where a missing token is answered by the concealed <c>404</c> and a declared <c>401</c>
/// would itself be the tell (Requirements 2.8, 3.3, 3.4, 5.4).</item>
/// <item><b>No framework challenge on an anonymous endpoint</b>
/// (<see cref="AnonymousEndpointsDeclaringAuthorisationStatus(IEnumerable{MappedEndpoint}, IReadOnlyList{string})"/>) —
/// an endpoint reachable without a token declares neither <c>401</c> nor <c>403</c>, unless its route
/// is one of the explicitly listed public auth routes whose error seam genuinely returns those
/// statuses as the endpoint's own outcome rather than as a gate (Requirement 2.9).</item>
/// </list>
/// <para>
/// Both exception lists are <i>taken as input</i> rather than declared here. They are the guard's
/// hand-maintained lists, each pinned to its size and shape by its own test in
/// <see cref="EndpointMetadataGuardTests"/>, and re-declaring them in the rule would create exactly the
/// second copy this extraction exists to avoid: a rule that excused a route the guard's own pinning
/// test never saw.
/// </para>
/// <para>
/// Every violation is returned rather than the first, and each message names the route and method — and
/// the offending status where a status is what is wrong — because the guard's output is a worklist and
/// an unnamed offender is not findable in the source (Requirements 3.2, 3.3).
/// </para>
/// </summary>
internal static class AuthorizationDeclarationRule
{
    /// <summary>
    /// The two statuses an anonymous endpoint must not declare, in ascending order so a failure
    /// worklist reads the same way across runs.
    /// </summary>
    private static readonly int[] AuthorisationStatuses =
        [StatusCodes.Status401Unauthorized, StatusCodes.Status403Forbidden];

    /// <summary>
    /// Applies the <c>401</c> correspondence to one endpoint (Requirements 2.8, 3.3, 3.4, 5.4).
    /// </summary>
    /// <param name="endpoint">The endpoint to judge.</param>
    /// <param name="statsRoutesExemptFromDeclaredUnauthorized">
    /// The explicit stats exception — the routes whose missing <c>401</c> is intended, because a
    /// missing token there resolves to the same concealed <c>404</c> as a target that does not exist.
    /// </param>
    /// <returns>
    /// One message naming the endpoint's route and method when it is guarded, outside the exception,
    /// and declares no <c>401</c>; empty otherwise.
    /// </returns>
    public static IReadOnlyList<string> AuthorisedEndpointsMissingUnauthorized(
        MappedEndpoint endpoint,
        IReadOnlyList<string> statsRoutesExemptFromDeclaredUnauthorized)
    {
        ArgumentNullException.ThrowIfNull(endpoint);
        ArgumentNullException.ThrowIfNull(statsRoutesExemptFromDeclaredUnauthorized);

        if (!endpoint.RequiresAuthorization
            || IsExempt(endpoint, statsRoutesExemptFromDeclaredUnauthorized))
        {
            return [];
        }

        return endpoint.Declares(StatusCodes.Status401Unauthorized)
            ? []
            : [$"{endpoint.Description} requires authorisation but does not declare 401."];
    }

    /// <summary>
    /// Applies the <c>401</c> correspondence across a set of endpoints, gathering every offender so the
    /// message is a declaration worklist rather than a single first failure.
    /// </summary>
    /// <param name="endpoints">The endpoints to judge.</param>
    /// <param name="statsRoutesExemptFromDeclaredUnauthorized">The explicit stats exception.</param>
    /// <returns>One message per violation across the whole set.</returns>
    public static IReadOnlyList<string> AuthorisedEndpointsMissingUnauthorized(
        IEnumerable<MappedEndpoint> endpoints,
        IReadOnlyList<string> statsRoutesExemptFromDeclaredUnauthorized)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        return
        [
            .. endpoints.SelectMany(
                endpoint => AuthorisedEndpointsMissingUnauthorized(
                    endpoint,
                    statsRoutesExemptFromDeclaredUnauthorized)),
        ];
    }

    /// <summary>
    /// Applies the anonymous-declares-neither rule to one endpoint (Requirement 2.9).
    /// </summary>
    /// <param name="endpoint">The endpoint to judge.</param>
    /// <param name="anonymousRoutesEmittingDomainAuthStatuses">
    /// The explicit anonymous-auth exception — the public auth routes whose seam really does answer
    /// <c>401</c> or <c>403</c> as the endpoint's own outcome, so declaring it is a contract the client
    /// needs rather than an advertisement of a gate that is not there.
    /// </param>
    /// <returns>
    /// One message per prohibited status the endpoint declares, each naming the route, the method and
    /// the status; empty when the endpoint is guarded, exempt, or declares neither.
    /// </returns>
    public static IReadOnlyList<string> AnonymousEndpointsDeclaringAuthorisationStatus(
        MappedEndpoint endpoint,
        IReadOnlyList<string> anonymousRoutesEmittingDomainAuthStatuses)
    {
        ArgumentNullException.ThrowIfNull(endpoint);
        ArgumentNullException.ThrowIfNull(anonymousRoutesEmittingDomainAuthStatuses);

        if (!endpoint.IsAnonymous || IsExempt(endpoint, anonymousRoutesEmittingDomainAuthStatuses))
        {
            return [];
        }

        var violations = new List<string>();

        foreach (int status in AuthorisationStatuses)
        {
            if (endpoint.Declares(status))
            {
                violations.Add($"{endpoint.Description} is anonymous but declares {status}.");
            }
        }

        return violations;
    }

    /// <summary>
    /// Applies the anonymous-declares-neither rule across a set of endpoints, gathering every offender.
    /// </summary>
    /// <param name="endpoints">The endpoints to judge.</param>
    /// <param name="anonymousRoutesEmittingDomainAuthStatuses">
    /// The explicit anonymous-auth exception.
    /// </param>
    /// <returns>One message per violation across the whole set.</returns>
    public static IReadOnlyList<string> AnonymousEndpointsDeclaringAuthorisationStatus(
        IEnumerable<MappedEndpoint> endpoints,
        IReadOnlyList<string> anonymousRoutesEmittingDomainAuthStatuses)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        return
        [
            .. endpoints.SelectMany(
                endpoint => AnonymousEndpointsDeclaringAuthorisationStatus(
                    endpoint,
                    anonymousRoutesEmittingDomainAuthStatuses)),
        ];
    }

    /// <summary>
    /// Whether the endpoint's route appears in the given exception list. Matched on the raw route
    /// pattern, ordinally, so an exception entry has to name the route exactly as it was mapped.
    /// </summary>
    private static bool IsExempt(MappedEndpoint endpoint, IReadOnlyList<string> exemptRoutes) =>
        exemptRoutes.Contains(endpoint.Route, StringComparer.Ordinal);
}
