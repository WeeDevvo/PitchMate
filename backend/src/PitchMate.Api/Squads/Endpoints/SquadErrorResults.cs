using PitchMate.Domain.Squads;

namespace PitchMate.Api.Squads.Endpoints;

/// <summary>
/// The single translation seam from an Application/Domain <see cref="SquadError"/> to an HTTP result.
/// Every squad endpoint delegates its decision to an Application use case and, on failure, hands the
/// returned <see cref="SquadError"/> to this helper — so the Api holds no squad logic and every
/// <see cref="SquadErrorCode"/> maps to exactly one HTTP status in one place (Requirement 19.4).
/// <para>
/// The mapping follows the design's error table. Two nuances honour the visibility requirements:
/// authorisation failures on <b>existence-sensitive reads</b> (a squad's data or its feature flags)
/// return <c>404 Not Found</c> rather than <c>403 Forbidden</c> so a non-member cannot learn whether
/// the squad exists (Requirement 16.2); and unauthenticated requests are rejected with <c>401</c>
/// before any handler runs by the JWT bearer middleware (Requirement 16.3), with
/// <see cref="Unauthenticated"/> covering the residual case where an authenticated principal carries
/// no resolvable subject.
/// </para>
/// </summary>
internal static class SquadErrorResults
{
    /// <summary>
    /// Maps a use case's <see cref="SquadError"/> to a <see cref="ProblemDetails"/> HTTP result. The
    /// stable <see cref="SquadErrorCode"/> is echoed in the problem's <c>title</c> and a <c>code</c>
    /// extension so clients branch on the code rather than parsing the human-readable message.
    /// </summary>
    /// <param name="error">The typed failure returned by an Application squad use case.</param>
    /// <param name="concealExistence">
    /// When <see langword="true"/> the endpoint is an existence-sensitive read: an
    /// <see cref="SquadErrorCode.Unauthorized"/> failure is reported as <c>404 Not Found</c> so the
    /// squad's existence is not revealed (Requirement 16.2).
    /// </param>
    /// <returns>An <see cref="IResult"/> carrying the mapped status code and problem body.</returns>
    public static IResult ToHttpResult(SquadError error, bool concealExistence = false)
    {
        ArgumentNullException.ThrowIfNull(error);

        int statusCode = error.Code switch
        {
            // Client-supplied input violated a length/enum/range policy.
            SquadErrorCode.ValidationFailed => StatusCodes.Status400BadRequest,

            // A non-expiring invite was requested where configuration forbids it.
            SquadErrorCode.ExpiryRequired => StatusCodes.Status400BadRequest,

            // The caller lacks the required role/state. For existence-sensitive reads this is masked
            // as 404 so a non-member cannot distinguish "not allowed" from "does not exist".
            SquadErrorCode.Unauthorized =>
                concealExistence ? StatusCodes.Status404NotFound : StatusCodes.Status403Forbidden,

            // The target does not resolve to a membership in the squad — nothing to act on.
            SquadErrorCode.NotAMember => StatusCodes.Status404NotFound,

            // A uniqueness rule was violated (normalised display name collision).
            SquadErrorCode.DisplayNameInUse => StatusCodes.Status409Conflict,

            // The single-owner rule would be broken (owner leaving/removal/demotion/erasure).
            SquadErrorCode.OwnerConstraint => StatusCodes.Status409Conflict,

            // The 25-active-invite cap is already reached.
            SquadErrorCode.InviteLimitReached => StatusCodes.Status409Conflict,

            // Claim/reversal preconditions are unmet (no consent, already a member, non-guest target,
            // reverse with no completed claim).
            SquadErrorCode.ClaimNotEligible => StatusCodes.Status409Conflict,

            // The squad is soft-deleted; only export and reversal are permitted during the grace period.
            SquadErrorCode.SquadPendingDeletion => StatusCodes.Status409Conflict,

            // The row changed since it was loaded (xmin mismatch on save).
            SquadErrorCode.ConcurrencyConflict => StatusCodes.Status409Conflict,

            // The invite is missing, revoked, or expired — the resource is gone.
            SquadErrorCode.InviteUnusable => StatusCodes.Status410Gone,

            // "Already a member" is a success no-op at redemption, not a client error, so it is
            // reported as 200 rather than a problem body.
            SquadErrorCode.AlreadyMember => StatusCodes.Status200OK,

            // Any unmapped code is a server-side oversight rather than a client error.
            _ => StatusCodes.Status500InternalServerError,
        };

        // The already-member no-op carries no problem body; every other code is a genuine failure.
        if (statusCode == StatusCodes.Status200OK)
        {
            return Results.Ok();
        }

        return Results.Problem(
            detail: error.Message,
            statusCode: statusCode,
            title: error.Code.ToString(),
            extensions: new Dictionary<string, object?> { ["code"] = error.Code.ToString() });
    }

    /// <summary>
    /// The uniform unauthenticated result for a protected endpoint whose caller identity could not be
    /// resolved from the access token (Requirement 16.3). The body is deliberately empty so nothing is
    /// disclosed.
    /// </summary>
    public static IResult Unauthenticated() =>
        Results.Problem(
            statusCode: StatusCodes.Status401Unauthorized,
            title: "Unauthenticated",
            detail: "Authentication is required.");
}
