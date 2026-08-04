using PitchMate.Application.Stats;

namespace PitchMate.Api.Stats.Endpoints;

/// <summary>
/// The single translation seam from an Application <see cref="StatsError"/> to an HTTP result. Every
/// stats endpoint (Leaderboard, Profile) delegates its decision to an Application use case and, on
/// failure, hands the returned <see cref="StatsError"/> to this helper — so the Api holds no stats
/// logic and every <see cref="StatsErrorCode"/> maps to exactly one HTTP result in one place
/// (Requirement 15.4).
/// <para>
/// The mapping is deliberately existence-concealing. <see cref="StatsErrorCode.Unauthorized"/> and
/// <see cref="StatsErrorCode.NotFound"/> both map to a <b>byte-for-byte identical</b> <c>404 Not
/// Found</c> response — the same status and the same body — so a caller cannot distinguish "you are
/// not an active member" from "no such squad or membership" and therefore cannot probe for the
/// existence of a squad, membership, or another player's data (Requirements 1.2, 1.6, 3.6). Both
/// codes route through the single <see cref="Concealed"/> result so the two responses can never
/// drift apart. <see cref="StatsErrorCode.UnsupportedStatistic"/> maps to a <c>400</c> that names the
/// unsupported statistic (Requirement 4.7), and <see cref="StatsErrorCode.ComputationFailed"/> maps
/// to a <c>503</c> that carries only an error indication and never a partial or stale statistics
/// payload (Requirement 2.6).
/// </para>
/// </summary>
internal static class StatsErrorResults
{
    // The single, code-agnostic body used for BOTH Unauthorized and NotFound. Because neither the
    // status nor the body is derived from the error's differing Code or Message, the two failures
    // produce a byte-for-byte identical response and cannot be told apart (Requirements 1.2, 1.6, 3.6).
    private const string ConcealedTitle = "Not Found";
    private const string ConcealedDetail = "The requested resource was not found.";

    /// <summary>
    /// Maps a use case's <see cref="StatsError"/> to an HTTP result.
    /// </summary>
    /// <param name="error">The typed failure returned by an Application stats use case.</param>
    /// <returns>An <see cref="IResult"/> carrying the mapped status code and body.</returns>
    public static IResult ToHttpResult(StatsError error)
    {
        ArgumentNullException.ThrowIfNull(error);

        return error.Code switch
        {
            // Existence-concealing: an authorisation failure and a genuine "does not exist" are
            // answered identically so existence is never disclosed (Requirements 1.2, 1.6, 3.6).
            StatsErrorCode.Unauthorized => Concealed(),
            StatsErrorCode.NotFound => Concealed(),

            // The selected ranking statistic is not in the supported set. The message names the
            // offending statistic; this is not existence-sensitive, so the code is echoed (Req 4.7).
            StatsErrorCode.UnsupportedStatistic => Results.Problem(
                detail: error.Message,
                statusCode: StatusCodes.Status400BadRequest,
                title: error.Code.ToString(),
                extensions: new Dictionary<string, object?> { ["code"] = error.Code.ToString() }),

            // Aggregation failed or the store was unavailable. Respond with an error indication only —
            // never a partial or stale statistics payload (Requirement 2.6).
            StatsErrorCode.ComputationFailed => Results.Problem(
                detail: "The statistics could not be computed. Please try again later.",
                statusCode: StatusCodes.Status503ServiceUnavailable,
                title: error.Code.ToString(),
                extensions: new Dictionary<string, object?> { ["code"] = error.Code.ToString() }),

            // Any unmapped code is a server-side oversight rather than a client error.
            _ => Results.Problem(statusCode: StatusCodes.Status500InternalServerError),
        };
    }

    /// <summary>
    /// The single existence-concealing <c>404 Not Found</c> result, shared by
    /// <see cref="StatsErrorCode.Unauthorized"/>, <see cref="StatsErrorCode.NotFound"/>, and the
    /// residual missing/malformed/expired-token case at the endpoint edge (Requirement 1.6). The body
    /// is a fixed, code-agnostic <c>ProblemDetails</c> so every concealed rejection is byte-for-byte
    /// identical and discloses neither existence nor any statistical data.
    /// </summary>
    public static IResult Concealed() =>
        Results.Problem(
            detail: ConcealedDetail,
            statusCode: StatusCodes.Status404NotFound,
            title: ConcealedTitle);
}
