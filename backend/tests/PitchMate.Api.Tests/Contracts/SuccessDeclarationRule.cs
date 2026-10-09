using Microsoft.AspNetCore.Http;

namespace PitchMate.Api.Tests.Contracts;

/// <summary>
/// The success-declaration rule of Requirement 3.2, as a single predicate over one
/// <see cref="MappedEndpoint"/>.
/// <para>
/// <b>Validates: Requirements 1.1, 1.2, 1.3, 1.6, 3.2, 3.8</b>
/// </para>
/// <para>
/// The rule lives here, on its own, because two tests need to apply it and a rule applied twice is a
/// rule that can be satisfied twice differently. The Endpoint_Metadata_Guard
/// (<see cref="EndpointMetadataGuardTests.EveryMappedEndpointDeclaresItsSuccessResponse"/>) applies it
/// to the endpoints the running host reports; Property 1
/// (<see cref="EndpointSuccessDeclarationProperties"/>) applies it to those same endpoints <i>and</i>
/// to synthesised endpoints that deliberately break it, in order to show the rule has teeth. Had the
/// property re-expressed the rule in its own words, the two could drift — and the one that drifted
/// loosest would be the one that stayed green. There is one predicate, and both callers call it.
/// </para>
/// <para>
/// It has two halves, which are one rule:
/// </para>
/// <list type="bullet">
/// <item>An endpoint declaring <b>no 2xx at all</b> generates as <c>unknown</c> on the client, which is
/// the state this chore is undoing (Requirements 1.1, 3.2).</item>
/// <item>An endpoint declaring a <b>body-bearing 2xx with no type</b> generates as <c>unknown</c> just
/// as surely while looking declared, and a <b>valueless <c>204</c> carrying a type</b> is the same
/// mistake in reverse (Requirements 1.2, 1.3, 1.6).</item>
/// </list>
/// <para>
/// Every violation of an endpoint is returned rather than the first, and each message names the route
/// and method, because the guard's output is a declaration worklist and an unnamed offender is not
/// findable in the source (Requirement 3.2).
/// </para>
/// </summary>
internal static class SuccessDeclarationRule
{
    /// <summary>
    /// Applies the rule to one endpoint.
    /// </summary>
    /// <param name="endpoint">The endpoint to judge.</param>
    /// <returns>
    /// One message per violation, each naming the endpoint's route and method; empty when the endpoint
    /// declares its success response properly.
    /// </returns>
    public static IReadOnlyList<string> Violations(MappedEndpoint endpoint)
    {
        ArgumentNullException.ThrowIfNull(endpoint);

        IReadOnlyList<DeclaredResponse> successes = endpoint.DeclaredSuccessResponses;

        if (successes.Count == 0)
        {
            return [$"{endpoint.Description} declares no 2xx response."];
        }

        var violations = new List<string>();

        foreach (DeclaredResponse success in successes)
        {
            if (success.Status == StatusCodes.Status204NoContent && success.CarriesBodyType)
            {
                violations.Add(
                    $"{endpoint.Description} declares 204 with body type {success.BodyType!.Name}; "
                        + "a valueless success carries no body type.");
            }
            else if (success.Status != StatusCodes.Status204NoContent && !success.CarriesBodyType)
            {
                violations.Add(
                    $"{endpoint.Description} declares {success.Status} with no body type; "
                        + "a body-bearing success declares its response contract.");
            }
        }

        return violations;
    }

    /// <summary>
    /// Applies the rule across a set of endpoints, gathering every offender so the message is a
    /// worklist rather than a single first failure.
    /// </summary>
    /// <param name="endpoints">The endpoints to judge.</param>
    /// <returns>One message per violation across the whole set.</returns>
    public static IReadOnlyList<string> Violations(IEnumerable<MappedEndpoint> endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        return [.. endpoints.SelectMany(Violations)];
    }
}
