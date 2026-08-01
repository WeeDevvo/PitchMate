using PitchMate.Domain.Notifications;

namespace PitchMate.Api.Notifications.Endpoints;

/// <summary>
/// The single translation seam from a notification <see cref="NotificationError"/> to an HTTP result.
/// Every notification endpoint delegates its decision to an Application read-model handler and, on
/// failure, hands the returned <see cref="NotificationError"/> to this helper — so the Api holds no
/// notification logic and every <see cref="NotificationErrorCode"/> maps to exactly one HTTP status in
/// one place (Requirements 10.2, 13.4).
/// <para>
/// The mapping honours the read model's non-disclosure rule: an authorisation or ownership failure is
/// reported as the uniform <c>404 Not Found</c> — the handlers already collapse "unauthorised",
/// "not the caller's record", and "squad the caller cannot access" into the single
/// <see cref="NotificationErrorCode.NotFound"/> so existence is never revealed (Requirements 10.1, 10.3,
/// 10.4, 10.5). Unauthenticated requests are rejected with <c>401</c> before any handler runs by the JWT
/// bearer middleware; <see cref="Unauthenticated"/> covers the residual case where an authenticated
/// principal carries no resolvable subject.
/// </para>
/// </summary>
internal static class NotificationErrorResults
{
    /// <summary>
    /// Maps a read-model handler's <see cref="NotificationError"/> to a <see cref="ProblemDetails"/> HTTP
    /// result. The stable <see cref="NotificationErrorCode"/> is echoed in the problem's <c>title</c> and a
    /// <c>code</c> extension so clients branch on the code rather than parsing the human-readable message.
    /// </summary>
    /// <param name="error">The typed failure returned by an Application notification handler.</param>
    /// <returns>An <see cref="IResult"/> carrying the mapped status code and problem body.</returns>
    public static IResult ToHttpResult(NotificationError error)
    {
        ArgumentNullException.ThrowIfNull(error);

        int statusCode = error.Code switch
        {
            // No authenticated caller for a request that requires one.
            NotificationErrorCode.Unauthenticated => StatusCodes.Status401Unauthorized,

            // The record is not backed by the caller, or the squad scope is inaccessible. Reported as a
            // uniform 404 so existence is never disclosed (Requirements 10.1, 10.3, 10.4, 10.5).
            NotificationErrorCode.NotFound => StatusCodes.Status404NotFound,

            // Client-supplied input violated a length/enum/range policy.
            NotificationErrorCode.ValidationFailed => StatusCodes.Status400BadRequest,

            // A client-supplied bad read-state transition (Read -> Unread) is a client error.
            NotificationErrorCode.InvalidReadStateTransition => StatusCodes.Status400BadRequest,

            // A publish supplied a value outside the eight defined notification types.
            NotificationErrorCode.UnknownNotificationType => StatusCodes.Status400BadRequest,

            // Recipient resolution / atomic commit failure — a server-side fault. Mapped for totality even
            // though it cannot arise on the read-model endpoints.
            NotificationErrorCode.PublishFailed => StatusCodes.Status500InternalServerError,

            // A lifecycle removal could not complete — a server-side fault. Mapped for totality.
            NotificationErrorCode.RemovalFailed => StatusCodes.Status500InternalServerError,

            // Any unmapped code is a server-side oversight rather than a client error.
            _ => StatusCodes.Status500InternalServerError,
        };

        return Results.Problem(
            detail: error.Message,
            statusCode: statusCode,
            title: error.Code.ToString(),
            extensions: new Dictionary<string, object?> { ["code"] = error.Code.ToString() });
    }

    /// <summary>
    /// The uniform unauthenticated result for a protected endpoint whose caller identity could not be
    /// resolved from the access token (Requirement 10.2). The body is deliberately empty so nothing is
    /// disclosed.
    /// </summary>
    public static IResult Unauthenticated() =>
        Results.Problem(
            statusCode: StatusCodes.Status401Unauthorized,
            title: "Unauthenticated",
            detail: "Authentication is required.");
}
