namespace PitchMate.Api.Stats.Endpoints;

/// <summary>
/// Declares the problem statuses <see cref="StatsErrorResults"/> can emit, so the declared contract and
/// the seam's mapping table have one source of truth (design D3, Requirement 2.1). The two stats
/// endpoints compose this convention (Requirement 2.2), and the seam-coverage guard asserts every status
/// the seam can produce appears in <see cref="DeclaredProblemStatuses"/>.
/// <para>
/// This seam is wholly existence-concealing, which is why it has a single variant and why that variant
/// declares <b>no <c>401</c></b> — the only deliberate exception to the rule that an authorised endpoint
/// declares <c>401</c> (Requirements 2.6, 2.8). A missing, malformed or expired token on a stats read
/// yields the same code-agnostic <see cref="StatsErrorResults.Concealed"/> <c>404</c> as an
/// authorisation failure and as a genuine absence, so declaring <c>401</c> here would describe a
/// response the surface never emits and would hand a caller a tell it does not otherwise have. The two
/// routes are the endpoint-metadata guard's explicitly listed exception.
/// </para>
/// <para>
/// Every declared status carries the one <c>ProblemDetails</c> body shape written by the seam, so the
/// generated client sees a single problem type rather than one per operation (Requirement 2.10). The
/// <c>400</c> and <c>503</c> bodies carry the <c>code</c> extension holding the stable
/// <see cref="PitchMate.Application.Stats.StatsErrorCode"/> name — that extension, not the
/// human-readable <c>detail</c>, is the value a client branches on (Requirement 2.11) — while the
/// concealed <c>404</c> deliberately carries no <c>code</c>, so the declared contract exposes no value
/// from which the concealed cause could be recovered.
/// </para>
/// </summary>
internal static class StatsResponseConventions
{
    /// <summary>
    /// The statuses <see cref="StatsErrorResults.ToHttpResult"/> can emit, read off its mapping table
    /// (Requirement 2.6): <c>400</c> an unsupported ranking statistic, <c>404</c> the single concealed
    /// result shared by unauthorized and not-found, <c>503</c> a failed or unavailable aggregation, and
    /// <c>500</c> the unmapped-code fallback. No <c>401</c>, as documented on the class.
    /// </summary>
    internal static readonly IReadOnlyList<int> DeclaredProblemStatuses =
    [
        StatusCodes.Status400BadRequest,
        StatusCodes.Status404NotFound,
        StatusCodes.Status500InternalServerError,
        StatusCodes.Status503ServiceUnavailable,
    ];

    /// <summary>
    /// Declares the problem statuses of the stats seam on an endpoint, each carrying the single
    /// <c>ProblemDetails</c> body shape. Declares no <c>401</c>: a missing token on a stats read is
    /// answered with the concealed <c>404</c> (Requirement 2.8).
    /// </summary>
    /// <typeparam name="TBuilder">The endpoint convention builder being configured.</typeparam>
    /// <param name="builder">The endpoint (or group) to declare the problem responses on.</param>
    /// <returns>The same <paramref name="builder"/> for chaining.</returns>
    public static TBuilder WithStatsProblemResponses<TBuilder>(this TBuilder builder)
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
