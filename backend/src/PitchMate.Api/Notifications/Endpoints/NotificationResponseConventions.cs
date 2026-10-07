namespace PitchMate.Api.Notifications.Endpoints;

/// <summary>
/// Declares the problem statuses <see cref="NotificationErrorResults"/> can emit, so the declared
/// contract and the seam's mapping table have one source of truth (design D3, Requirement 2.1). The four
/// notification endpoints compose one of these variants (Requirement 2.2), and the seam-coverage guard
/// asserts every status the seam can produce appears in <see cref="DeclaredProblemStatuses"/>.
/// <para>
/// Every declared status carries the one <c>ProblemDetails</c> body shape written by the seam, so the
/// generated client sees a single problem type rather than one per operation (Requirement 2.10). The
/// body carries the <c>code</c> extension holding the stable
/// <see cref="PitchMate.Domain.Notifications.NotificationErrorCode"/> name — that extension, not the
/// human-readable <c>detail</c>, is the value a client branches on (Requirement 2.11).
/// </para>
/// </summary>
internal static class NotificationResponseConventions
{
    /// <summary>
    /// The statuses <see cref="NotificationErrorResults.ToHttpResult"/> can emit, read off its mapping
    /// table (Requirement 2.7): <c>400</c> validation-failed, a bad read-state transition and an unknown
    /// notification type, <c>401</c> the residual unresolvable-subject case, <c>404</c> the uniform
    /// not-found the handlers collapse ownership and squad-scope failures into, and <c>500</c> the
    /// publish/removal faults and the unmapped-code fallback.
    /// <para>
    /// <c>403</c> is absent because it is absent from the mapping table: the read-model handlers report
    /// an authorisation or ownership failure as <see cref="PitchMate.Domain.Notifications.NotificationErrorCode.NotFound"/>
    /// rather than as a distinct authorisation code, so the seam never has a <c>403</c> to emit.
    /// </para>
    /// </summary>
    internal static readonly IReadOnlyList<int> DeclaredProblemStatuses =
    [
        StatusCodes.Status400BadRequest,
        StatusCodes.Status401Unauthorized,
        StatusCodes.Status404NotFound,
        StatusCodes.Status500InternalServerError,
    ];

    /// <summary>
    /// Declares the problem statuses of the notification seam on an endpoint, each carrying the single
    /// <c>ProblemDetails</c> body shape.
    /// </summary>
    /// <typeparam name="TBuilder">The endpoint convention builder being configured.</typeparam>
    /// <param name="builder">The endpoint (or group) to declare the problem responses on.</param>
    /// <returns>The same <paramref name="builder"/> for chaining.</returns>
    public static TBuilder WithNotificationProblemResponses<TBuilder>(this TBuilder builder)
        where TBuilder : IEndpointConventionBuilder =>
        builder.Declare(DeclaredProblemStatuses);

    /// <summary>
    /// Declares the problem statuses of the notification seam on an existence-sensitive read, where an
    /// authorisation or ownership failure is reported as <c>404</c> so no notification's existence — nor
    /// the squad scope behind it — is revealed (Requirements 2.3, 5.3). <c>403</c> is absent from the
    /// declared set, and <c>404</c> is present.
    /// <para>
    /// The declared set is identical to <see cref="WithNotificationProblemResponses{TBuilder}"/> by
    /// construction, because this seam's concealment happens one layer in: the handlers collapse the
    /// authorisation failure into <see cref="PitchMate.Domain.Notifications.NotificationErrorCode.NotFound"/>
    /// before the seam sees it, so there is no <c>403</c> to replace. The variant exists so the
    /// non-disclosing intent is explicit at each call site rather than inferred from the absence of a
    /// status, and so the concealing-endpoint guard has something to assert against — the
    /// <see cref="ExistenceConcealingMetadata"/> this variant attaches, and the standard variant does
    /// not, is the only thing that distinguishes the two.
    /// </para>
    /// </summary>
    /// <typeparam name="TBuilder">The endpoint convention builder being configured.</typeparam>
    /// <param name="builder">The endpoint (or group) to declare the problem responses on.</param>
    /// <returns>The same <paramref name="builder"/> for chaining.</returns>
    public static TBuilder WithNotificationConcealedProblemResponses<TBuilder>(this TBuilder builder)
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
