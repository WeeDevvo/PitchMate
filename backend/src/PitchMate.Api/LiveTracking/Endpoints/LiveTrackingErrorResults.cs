using PitchMate.Domain.LiveTracking;

namespace PitchMate.Api.LiveTracking.Endpoints;

/// <summary>
/// The single translation seam from an Application/Domain <see cref="LiveTrackingError"/> to an HTTP
/// result. Every live-tracking endpoint delegates its decision to an Application use case and, on a
/// whole-request failure, hands the returned <see cref="LiveTrackingError"/> to this helper — so the
/// Api holds no live-tracking logic and every <see cref="LiveTrackingErrorCode"/> maps to exactly one
/// HTTP result in one place. Per-event <c>Duplicate</c>/<c>Rejected</c> outcomes are not failures of
/// the request and are carried in the <c>BatchResult</c> body of a <c>200</c> response; this seam maps
/// only the codes that fail the request as a whole.
/// <para>
/// The mapping is deliberately existence-concealing. <see cref="LiveTrackingErrorCode.Unauthorized"/>
/// and <see cref="LiveTrackingErrorCode.NotFound"/> both map to a <b>byte-for-byte identical</b>
/// <c>404 Not Found</c> response — the same status and the same body — so a caller who is not a member
/// of the match's squad cannot distinguish "you are not permitted" from "no such match" and therefore
/// cannot probe for the existence of another squad's match or its live detail (Requirement 11.4).
/// Both codes route through the single <see cref="Concealed"/> result so the two responses can never
/// drift apart. <see cref="LiveTrackingErrorCode.NotEnabled"/> (the squad's <c>LiveMatchTracking</c>
/// flag is off, Requirement 9.1), <see cref="LiveTrackingErrorCode.MatchNotStarted"/> (recording
/// before <c>InProgress</c>, Requirement 7.2), and <see cref="LiveTrackingErrorCode.LogSealed"/> (the
/// match is <c>Completed</c> or <c>Cancelled</c>, Requirement 7.3) are lifecycle/state conflicts and
/// map to <c>409 Conflict</c>. <see cref="LiveTrackingErrorCode.ValidationFailed"/> (an empty batch or
/// a bad whole-request input) and <see cref="LiveTrackingErrorCode.TargetNotFound"/> (a retraction
/// naming a target that does not exist, Requirement 5.3) are input failures and map to
/// <c>400 Bad Request</c>.
/// </para>
/// </summary>
internal static class LiveTrackingErrorResults
{
    // The single, code-agnostic body used for BOTH Unauthorized and NotFound. Because neither the
    // status nor the body is derived from the error's differing Code or Message, the two failures
    // produce a byte-for-byte identical response and cannot be told apart (Requirement 11.4).
    private const string ConcealedTitle = "Not Found";
    private const string ConcealedDetail = "The requested resource was not found.";

    /// <summary>
    /// Maps a use case's <see cref="LiveTrackingError"/> to an HTTP result. The stable
    /// <see cref="LiveTrackingErrorCode"/> is echoed in the problem's <c>title</c> and a <c>code</c>
    /// extension for the non-concealed failures so clients branch on the code rather than parsing the
    /// human-readable message; the concealed <c>404</c> deliberately echoes neither.
    /// </summary>
    /// <param name="error">The typed failure returned by an Application live-tracking use case.</param>
    /// <returns>An <see cref="IResult"/> carrying the mapped status code and body.</returns>
    public static IResult ToHttpResult(LiveTrackingError error)
    {
        ArgumentNullException.ThrowIfNull(error);

        return error.Code switch
        {
            // Existence-concealing: an authorisation failure and a genuine "does not exist" are
            // answered identically so a non-member cannot learn whether the match exists (Req 11.4).
            LiveTrackingErrorCode.Unauthorized => Concealed(),
            LiveTrackingErrorCode.NotFound => Concealed(),

            // The squad does not have the LiveMatchTracking feature enabled (Requirement 9.1).
            LiveTrackingErrorCode.NotEnabled => Conflict(error),

            // The match has not started — recording is only permitted while InProgress (Req 7.2).
            LiveTrackingErrorCode.MatchNotStarted => Conflict(error),

            // The match log is sealed because the match is Completed or Cancelled (Requirement 7.3).
            LiveTrackingErrorCode.LogSealed => Conflict(error),

            // A whole-request input violated a validation rule (an empty batch, a bad Event_Id, or a
            // malformed request body).
            LiveTrackingErrorCode.ValidationFailed => BadRequest(error),

            // A retraction named a target event that does not exist in the match (Requirement 5.3) —
            // an input failure identifying the missing target.
            LiveTrackingErrorCode.TargetNotFound => BadRequest(error),

            // Any unmapped code is a server-side oversight rather than a client error.
            _ => Results.Problem(statusCode: StatusCodes.Status500InternalServerError),
        };
    }

    /// <summary>
    /// The single existence-concealing <c>404 Not Found</c> result, shared by
    /// <see cref="LiveTrackingErrorCode.Unauthorized"/> and <see cref="LiveTrackingErrorCode.NotFound"/>
    /// (Requirement 11.4). The body is a fixed, code-agnostic <c>ProblemDetails</c> so every concealed
    /// rejection is byte-for-byte identical and discloses neither existence nor any match data.
    /// </summary>
    public static IResult Concealed() =>
        Results.Problem(
            detail: ConcealedDetail,
            statusCode: StatusCodes.Status404NotFound,
            title: ConcealedTitle);

    /// <summary>
    /// The uniform unauthenticated result for a protected endpoint whose caller identity could not be
    /// resolved from the access token. The body is deliberately minimal so nothing is disclosed.
    /// </summary>
    public static IResult Unauthenticated() =>
        Results.Problem(
            statusCode: StatusCodes.Status401Unauthorized,
            title: "Unauthenticated",
            detail: "Authentication is required.");

    // A 409 Conflict problem echoing the stable code, for lifecycle/feature-state failures.
    private static IResult Conflict(LiveTrackingError error) =>
        Problem(error, StatusCodes.Status409Conflict);

    // A 400 Bad Request problem echoing the stable code, for input/validation failures.
    private static IResult BadRequest(LiveTrackingError error) =>
        Problem(error, StatusCodes.Status400BadRequest);

    private static IResult Problem(LiveTrackingError error, int statusCode) =>
        Results.Problem(
            detail: error.Message,
            statusCode: statusCode,
            title: error.Code.ToString(),
            extensions: new Dictionary<string, object?> { ["code"] = error.Code.ToString() });
}
