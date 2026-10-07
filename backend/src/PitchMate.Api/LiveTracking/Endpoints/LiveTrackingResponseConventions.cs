namespace PitchMate.Api.LiveTracking.Endpoints;

/// <summary>
/// Declares the problem statuses <see cref="LiveTrackingErrorResults"/> can emit, so the declared
/// contract and the seam's mapping table have one source of truth (design D3, Requirement 2.1). The three
/// live-tracking endpoints compose one of these variants (Requirement 2.2), and the seam-coverage guard
/// asserts every status the seam can produce appears in <see cref="DeclaredProblemStatuses"/>.
/// <para>
/// Only whole-request failures are declared here. Per-event <c>Duplicate</c>/<c>Rejected</c> outcomes are
/// not failures of the request: they are carried in the batch result body of a <c>200</c> response, and
/// are part of that endpoint's success contract rather than its problem set.
/// </para>
/// <para>
/// Every declared status carries the one <c>ProblemDetails</c> body shape written by the seam, so the
/// generated client sees a single problem type rather than one per operation (Requirement 2.10). The
/// <c>400</c> and <c>409</c> bodies carry the <c>code</c> extension holding the stable
/// <see cref="PitchMate.Domain.LiveTracking.LiveTrackingErrorCode"/> name — that extension, not the
/// human-readable <c>detail</c>, is the value a client branches on (Requirement 2.11) — while the
/// concealed <c>404</c> deliberately carries no <c>code</c>, so the declared contract exposes no value
/// from which the concealed cause could be recovered.
/// </para>
/// </summary>
internal static class LiveTrackingResponseConventions
{
    /// <summary>
    /// The statuses <see cref="LiveTrackingErrorResults.ToHttpResult"/> can emit, read off its mapping
    /// table (Requirement 2.7): <c>400</c> validation-failed and a retraction naming a target that does
    /// not exist, <c>401</c> the residual unresolvable-subject case, <c>404</c> the single concealed
    /// result shared by unauthorized and not-found, <c>409</c> the not-enabled, match-not-started and
    /// log-sealed lifecycle conflicts, and <c>500</c> the unmapped-code fallback.
    /// <para>
    /// <c>403</c> is absent because it is absent from the mapping table: the seam answers
    /// <see cref="PitchMate.Domain.LiveTracking.LiveTrackingErrorCode.Unauthorized"/> with the concealed
    /// <c>404</c>, so there is never a <c>403</c> to emit.
    /// </para>
    /// </summary>
    internal static readonly IReadOnlyList<int> DeclaredProblemStatuses =
    [
        StatusCodes.Status400BadRequest,
        StatusCodes.Status401Unauthorized,
        StatusCodes.Status404NotFound,
        StatusCodes.Status409Conflict,
        StatusCodes.Status500InternalServerError,
    ];

    /// <summary>
    /// Declares the problem statuses of the live-tracking seam on an endpoint, each carrying the single
    /// <c>ProblemDetails</c> body shape.
    /// </summary>
    /// <typeparam name="TBuilder">The endpoint convention builder being configured.</typeparam>
    /// <param name="builder">The endpoint (or group) to declare the problem responses on.</param>
    /// <returns>The same <paramref name="builder"/> for chaining.</returns>
    public static TBuilder WithLiveTrackingProblemResponses<TBuilder>(this TBuilder builder)
        where TBuilder : IEndpointConventionBuilder =>
        builder.Declare(DeclaredProblemStatuses);

    /// <summary>
    /// Declares the problem statuses of the live-tracking seam on an existence-sensitive endpoint, where
    /// an authorisation failure is reported as the concealed <c>404</c> so a caller who is not a member of
    /// the match's squad cannot learn whether the match exists (Requirements 2.3, 5.3). <c>403</c> is
    /// absent from the declared set, and <c>404</c> is present.
    /// <para>
    /// The declared set is identical to <see cref="WithLiveTrackingProblemResponses{TBuilder}"/> by
    /// construction, because this seam conceals unconditionally: both unauthorized and not-found route
    /// through the one <see cref="LiveTrackingErrorResults.Concealed"/> result, so there is no <c>403</c>
    /// to replace. The variant exists so the non-disclosing intent is explicit at each call site rather
    /// than inferred from the absence of a status, and so the concealing-endpoint guard has something to
    /// assert against — the <see cref="ExistenceConcealingMetadata"/> this variant attaches, and the
    /// standard variant does not, is the only thing that distinguishes the two.
    /// </para>
    /// </summary>
    /// <typeparam name="TBuilder">The endpoint convention builder being configured.</typeparam>
    /// <param name="builder">The endpoint (or group) to declare the problem responses on.</param>
    /// <returns>The same <paramref name="builder"/> for chaining.</returns>
    public static TBuilder WithLiveTrackingConcealedProblemResponses<TBuilder>(this TBuilder builder)
        where TBuilder : IEndpointConventionBuilder =>
        builder.Declare(DeclaredProblemStatuses)
            .WithMetadata(ExistenceConcealingMetadata.Instance);

    private static TBuilder Declare<TBuilder>(this TBuilder builder, IReadOnlyList<int> statusCodes)
        where TBuilder : IEndpointConventionBuilder
    {
        ArgumentNullException.ThrowIfNull(builder);

        foreach (int statusCode in statusCodes)
        {
            builder.ProducesProblem(statusCode);
        }

        return builder;
    }
}
