namespace PitchMate.Api.Auth.Endpoints;

/// <summary>
/// Declares the problem statuses <see cref="AuthErrorResults"/> can emit, so the declared contract and
/// the seam's mapping table have one source of truth (design D3, Requirement 2.1).
/// <para>
/// The status set is a property of the seam, not of each of the fifteen auth endpoints: hand-listing
/// <c>ProducesProblem</c> per endpoint would put the same list in fifteen places and let them drift
/// from the table that actually decides the status. Endpoints compose this convention instead
/// (Requirement 2.2), and the seam-coverage guard asserts every status the seam can produce appears in
/// <see cref="DeclaredProblemStatuses"/>.
/// </para>
/// <para>
/// Every declared status carries the one <c>ProblemDetails</c> body shape written by the seam, so the
/// generated client sees a single problem type rather than one per operation (Requirement 2.10). For
/// every auth failure that body carries the <c>code</c> extension holding the stable
/// <see cref="PitchMate.Application.Auth.AuthErrorCode"/> name — that extension, not the
/// human-readable <c>detail</c>, is the value a client branches on (Requirement 2.11). No auth failure
/// is existence-concealing, so this seam has a single variant.
/// </para>
/// </summary>
internal static class AuthResponseConventions
{
    /// <summary>
    /// The statuses <see cref="AuthErrorResults.ToHttpResult"/> can emit, read off its mapping table
    /// (Requirement 2.4): <c>400</c> validation/invalid-email/password-policy/token-invalid/
    /// token-expired, <c>401</c> authentication-failed and unauthenticated, <c>403</c>
    /// email-not-verified, <c>404</c> user-not-found, <c>409</c> the uniqueness and last-of-its-kind
    /// rules, <c>500</c> the unmapped-code fallback, and <c>502</c> a downstream email transport that
    /// failed after its retry budget.
    /// </summary>
    internal static readonly IReadOnlyList<int> DeclaredProblemStatuses =
    [
        StatusCodes.Status400BadRequest,
        StatusCodes.Status401Unauthorized,
        StatusCodes.Status403Forbidden,
        StatusCodes.Status404NotFound,
        StatusCodes.Status409Conflict,
        StatusCodes.Status500InternalServerError,
        StatusCodes.Status502BadGateway,
    ];

    /// <summary>
    /// Declares the problem statuses of the auth seam on an endpoint, each carrying the single
    /// <c>ProblemDetails</c> body shape.
    /// </summary>
    /// <typeparam name="TBuilder">The endpoint convention builder being configured.</typeparam>
    /// <param name="builder">The endpoint (or group) to declare the problem responses on.</param>
    /// <returns>The same <paramref name="builder"/> for chaining.</returns>
    public static TBuilder WithAuthProblemResponses<TBuilder>(this TBuilder builder)
        where TBuilder : IEndpointConventionBuilder
    {
        ArgumentNullException.ThrowIfNull(builder);

        foreach (int statusCode in DeclaredProblemStatuses)
        {
            builder.ProducesProblem(statusCode);
        }

        return builder;
    }
}
