namespace PitchMate.Api.Matches.Endpoints;

/// <summary>
/// Declares the problem statuses <see cref="MatchErrorResults"/> can emit, so the declared contract and
/// the seam's mapping table have one source of truth (design D3, Requirement 2.1).
/// <para>
/// The status set is a property of the seam, not of each of the eighteen match endpoints: hand-listing
/// <c>ProducesProblem</c> per endpoint would put the same list in eighteen places and let them drift from
/// the table that actually decides the status. Endpoints compose one of these variants instead
/// (Requirement 2.2), and the seam-coverage guard asserts every status the seam can produce appears in
/// <see cref="DeclaredProblemStatuses"/>.
/// </para>
/// <para>
/// Every declared status carries the one <c>ProblemDetails</c> body shape written by the seam, so the
/// generated client sees a single problem type rather than one per operation (Requirement 2.10). The body
/// carries the <c>code</c> extension holding the stable
/// <see cref="PitchMate.Domain.Matches.MatchErrorCode"/> name — that extension, not the human-readable
/// <c>detail</c>, is the value a client branches on (Requirement 2.11).
/// </para>
/// </summary>
internal static class MatchResponseConventions
{
    /// <summary>
    /// The statuses <see cref="MatchErrorResults.ToHttpResult"/> can emit on an endpoint that reports an
    /// authorisation failure as <c>403</c>, read off its mapping table (Requirement 2.7): <c>400</c>
    /// validation-failed, <c>401</c> the residual unresolvable-subject case, <c>403</c> unauthorized,
    /// <c>404</c> not-a-participant, <c>409</c> the invalid-state, threshold, already-participant,
    /// live-tracking-disabled, result-required and concurrency conflicts, and <c>500</c> the
    /// unmapped-code fallback.
    /// </summary>
    internal static readonly IReadOnlyList<int> DeclaredProblemStatuses =
    [
        StatusCodes.Status400BadRequest,
        StatusCodes.Status401Unauthorized,
        StatusCodes.Status403Forbidden,
        StatusCodes.Status404NotFound,
        StatusCodes.Status409Conflict,
        StatusCodes.Status500InternalServerError,
    ];

    /// <summary>
    /// The same set with <c>403</c> replaced by <c>404</c>, for an existence-sensitive read where the
    /// seam is called with <c>concealExistence: true</c> so a non-member cannot learn whether the match
    /// exists (Requirements 2.3, 2.7, 5.3). <c>404</c> is already present for not-a-participant, so the
    /// concealed authorisation failure is indistinguishable from a genuine absence.
    /// </summary>
    internal static readonly IReadOnlyList<int> DeclaredConcealedProblemStatuses =
    [
        StatusCodes.Status400BadRequest,
        StatusCodes.Status401Unauthorized,
        StatusCodes.Status404NotFound,
        StatusCodes.Status409Conflict,
        StatusCodes.Status500InternalServerError,
    ];

    /// <summary>
    /// Declares the problem statuses of the match seam on an endpoint that reports an authorisation
    /// failure as <c>403</c>, each carrying the single <c>ProblemDetails</c> body shape.
    /// </summary>
    /// <typeparam name="TBuilder">The endpoint convention builder being configured.</typeparam>
    /// <param name="builder">The endpoint (or group) to declare the problem responses on.</param>
    /// <returns>The same <paramref name="builder"/> for chaining.</returns>
    public static TBuilder WithMatchProblemResponses<TBuilder>(this TBuilder builder)
        where TBuilder : IEndpointConventionBuilder =>
        builder.Declare(DeclaredProblemStatuses);

    /// <summary>
    /// Declares the problem statuses of the match seam on an existence-sensitive read, where an
    /// authorisation failure is reported as <c>404</c> so the match's existence is not revealed
    /// (Requirements 2.3, 5.3). <c>403</c> is deliberately absent from the declared set.
    /// <para>
    /// Also attaches <see cref="ExistenceConcealingMetadata"/>, so the non-disclosing intent is a fact
    /// about the endpoint rather than something to be inferred from the absence of a status.
    /// </para>
    /// </summary>
    /// <typeparam name="TBuilder">The endpoint convention builder being configured.</typeparam>
    /// <param name="builder">The endpoint (or group) to declare the problem responses on.</param>
    /// <returns>The same <paramref name="builder"/> for chaining.</returns>
    public static TBuilder WithMatchConcealedProblemResponses<TBuilder>(this TBuilder builder)
        where TBuilder : IEndpointConventionBuilder =>
        builder.Declare(DeclaredConcealedProblemStatuses)
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
