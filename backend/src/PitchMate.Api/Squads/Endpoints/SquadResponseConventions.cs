namespace PitchMate.Api.Squads.Endpoints;

/// <summary>
/// Declares the problem statuses <see cref="SquadErrorResults"/> can emit, so the declared contract and
/// the seam's mapping table have one source of truth (design D3, Requirement 2.1).
/// <para>
/// The status set is a property of the seam, not of each of the twenty-four squad endpoints:
/// hand-listing <c>ProducesProblem</c> per endpoint would put the same list in twenty-four places and
/// let them drift from the table that actually decides the status. Endpoints compose one of these
/// variants instead (Requirement 2.2), and the seam-coverage guard asserts every status the seam can
/// produce appears in <see cref="DeclaredProblemStatuses"/>.
/// </para>
/// <para>
/// Every declared status carries the one <c>ProblemDetails</c> body shape written by the seam, so the
/// generated client sees a single problem type rather than one per operation (Requirement 2.10). For a
/// non-concealed failure that body carries the <c>code</c> extension holding the stable
/// <see cref="PitchMate.Domain.Squads.SquadErrorCode"/> name — that extension, not the human-readable
/// <c>detail</c>, is the value a client branches on (Requirement 2.11).
/// </para>
/// </summary>
internal static class SquadResponseConventions
{
    /// <summary>
    /// The statuses <see cref="SquadErrorResults.ToHttpResult"/> can emit on an endpoint that reports an
    /// authorisation failure as <c>403</c>, read off its mapping table (Requirement 2.5): <c>400</c>
    /// validation-failed and expiry-required, <c>401</c> the residual unresolvable-subject case,
    /// <c>403</c> unauthorized, <c>404</c> not-a-member, <c>409</c> the uniqueness, owner, invite-limit,
    /// claim-eligibility, pending-deletion, already-member and concurrency conflicts, <c>410</c> an
    /// invite that is missing, revoked or expired, and <c>500</c> the unmapped-code fallback.
    /// </summary>
    internal static readonly IReadOnlyList<int> DeclaredProblemStatuses =
    [
        StatusCodes.Status400BadRequest,
        StatusCodes.Status401Unauthorized,
        StatusCodes.Status403Forbidden,
        StatusCodes.Status404NotFound,
        StatusCodes.Status409Conflict,
        StatusCodes.Status410Gone,
        StatusCodes.Status500InternalServerError,
    ];

    /// <summary>
    /// The same set with <c>403</c> replaced by <c>404</c>, for an existence-sensitive read where the
    /// seam is called with <c>concealExistence: true</c> so a non-member cannot learn whether the squad
    /// exists (Requirements 2.3, 2.5, 5.3). <c>404</c> is already present for not-a-member, so the
    /// concealed authorisation failure is indistinguishable from a genuine absence.
    /// </summary>
    internal static readonly IReadOnlyList<int> DeclaredConcealedProblemStatuses =
    [
        StatusCodes.Status400BadRequest,
        StatusCodes.Status401Unauthorized,
        StatusCodes.Status404NotFound,
        StatusCodes.Status409Conflict,
        StatusCodes.Status410Gone,
        StatusCodes.Status500InternalServerError,
    ];

    /// <summary>
    /// The statuses reachable on the one squad endpoint that is <b>anonymous</b> — the pre-join invite
    /// preview, which answers from the Api without calling a handler and so never reaches the seam at
    /// all. Its failures are therefore not the seam's: no <c>404</c>, <c>409</c> or <c>410</c> is
    /// reachable, and critically no <c>401</c> or <c>403</c>, because the endpoint has no authorisation
    /// gate and declaring the framework's challenge would advertise one that is not there
    /// (Requirement 2.9). What remains is <c>400</c>, the framework's own rejection of a malformed
    /// request, and <c>500</c>, the unhandled fallback.
    /// </summary>
    internal static readonly IReadOnlyList<int> DeclaredAnonymousProblemStatuses =
    [
        StatusCodes.Status400BadRequest,
        StatusCodes.Status500InternalServerError,
    ];

    /// <summary>
    /// Declares the problem statuses of the squad seam on an endpoint that reports an authorisation
    /// failure as <c>403</c>, each carrying the single <c>ProblemDetails</c> body shape.
    /// </summary>
    /// <typeparam name="TBuilder">The endpoint convention builder being configured.</typeparam>
    /// <param name="builder">The endpoint (or group) to declare the problem responses on.</param>
    /// <returns>The same <paramref name="builder"/> for chaining.</returns>
    public static TBuilder WithSquadProblemResponses<TBuilder>(this TBuilder builder)
        where TBuilder : IEndpointConventionBuilder =>
        builder.Declare(DeclaredProblemStatuses);

    /// <summary>
    /// Declares the problem statuses of the squad seam on an existence-sensitive read, where an
    /// authorisation failure is reported as <c>404</c> so the squad's existence is not revealed
    /// (Requirements 2.3, 5.3). <c>403</c> is deliberately absent from the declared set.
    /// <para>
    /// Also attaches <see cref="ExistenceConcealingMetadata"/>, so the non-disclosing intent is a fact
    /// about the endpoint rather than something to be inferred from the absence of a status.
    /// </para>
    /// </summary>
    /// <typeparam name="TBuilder">The endpoint convention builder being configured.</typeparam>
    /// <param name="builder">The endpoint (or group) to declare the problem responses on.</param>
    /// <returns>The same <paramref name="builder"/> for chaining.</returns>
    public static TBuilder WithSquadConcealedProblemResponses<TBuilder>(this TBuilder builder)
        where TBuilder : IEndpointConventionBuilder =>
        builder.Declare(DeclaredConcealedProblemStatuses)
            .WithMetadata(ExistenceConcealingMetadata.Instance);

    /// <summary>
    /// Declares the problem statuses of the anonymous pre-join invite preview, which answers without
    /// reaching the seam and must therefore declare neither <c>401</c> nor <c>403</c>
    /// (Requirement 2.9). It is not in the endpoint-metadata guard's anonymous-auth exception list, so
    /// that prohibition applies to it unconditionally.
    /// </summary>
    /// <typeparam name="TBuilder">The endpoint convention builder being configured.</typeparam>
    /// <param name="builder">The endpoint (or group) to declare the problem responses on.</param>
    /// <returns>The same <paramref name="builder"/> for chaining.</returns>
    public static TBuilder WithSquadAnonymousProblemResponses<TBuilder>(this TBuilder builder)
        where TBuilder : IEndpointConventionBuilder =>
        builder.Declare(DeclaredAnonymousProblemStatuses);

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
