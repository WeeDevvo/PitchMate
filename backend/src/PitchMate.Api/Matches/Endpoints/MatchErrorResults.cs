using PitchMate.Domain.Matches;

namespace PitchMate.Api.Matches.Endpoints;

/// <summary>
/// The single translation seam from an Application/Domain <see cref="MatchError"/> to an HTTP result.
/// Every match endpoint delegates its decision to an Application use case and, on failure, hands the
/// returned <see cref="MatchError"/> to this helper — so the Api holds no match-lifecycle logic and
/// every <see cref="MatchErrorCode"/> maps to exactly one HTTP status in one place (Requirement 16.4).
/// <para>
/// Two nuances honour the squad-scope and visibility requirements. Authorisation failures on
/// <b>existence-sensitive reads</b> (a match's availability tally or team sheet) return
/// <c>404 Not Found</c> rather than <c>403 Forbidden</c> so a non-member cannot learn whether the
/// match exists (Requirement 14.4). Unauthenticated requests are rejected with <c>401</c> before any
/// handler runs by the JWT bearer middleware, with <see cref="Unauthenticated"/> covering the residual
/// case where an authenticated principal carries no resolvable subject.
/// </para>
/// </summary>
internal static class MatchErrorResults
{
    /// <summary>
    /// Maps a use case's <see cref="MatchError"/> to a <see cref="ProblemDetails"/> HTTP result. The
    /// stable <see cref="MatchErrorCode"/> is echoed in the problem's <c>title</c> and a <c>code</c>
    /// extension so clients branch on the code rather than parsing the human-readable message.
    /// </summary>
    /// <param name="error">The typed failure returned by an Application match use case.</param>
    /// <param name="concealExistence">
    /// When <see langword="true"/> the endpoint is an existence-sensitive read: an
    /// <see cref="MatchErrorCode.Unauthorized"/> failure is reported as <c>404 Not Found</c> so the
    /// match's existence is not revealed (Requirement 14.4).
    /// </param>
    /// <returns>An <see cref="IResult"/> carrying the mapped status code and problem body.</returns>
    public static IResult ToHttpResult(MatchError error, bool concealExistence = false)
    {
        ArgumentNullException.ThrowIfNull(error);

        int statusCode = error.Code switch
        {
            // Client-supplied input violated a length/count/range/eligibility policy.
            MatchErrorCode.ValidationFailed => StatusCodes.Status400BadRequest,

            // The caller lacks the required role/state. For existence-sensitive reads this is masked
            // as 404 so a non-member cannot distinguish "not allowed" from "does not exist"
            // (Requirement 14.4).
            MatchErrorCode.Unauthorized =>
                concealExistence ? StatusCodes.Status404NotFound : StatusCodes.Status403Forbidden,

            // The action is not permitted from the match's current lifecycle state.
            MatchErrorCode.InvalidState => StatusCodes.Status409Conflict,

            // The available player count did not meet the squad's minimum confirmation threshold.
            MatchErrorCode.ThresholdNotMet => StatusCodes.Status409Conflict,

            // The targeted membership is not a participant of the match — nothing to act on.
            MatchErrorCode.NotAParticipant => StatusCodes.Status404NotFound,

            // The targeted membership is already a participant — a uniqueness violation.
            MatchErrorCode.AlreadyParticipant => StatusCodes.Status409Conflict,

            // A rich result was requested where the squad has live tracking disabled.
            MatchErrorCode.LiveTrackingDisabled => StatusCodes.Status409Conflict,

            // Completion was requested before a result was recorded.
            MatchErrorCode.ResultRequired => StatusCodes.Status409Conflict,

            // The row changed since it was loaded (xmin mismatch on save).
            MatchErrorCode.ConcurrencyConflict => StatusCodes.Status409Conflict,

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
    /// resolved from the access token. The body is deliberately empty so nothing is disclosed.
    /// </summary>
    public static IResult Unauthenticated() =>
        Results.Problem(
            statusCode: StatusCodes.Status401Unauthorized,
            title: "Unauthenticated",
            detail: "Authentication is required.");
}
