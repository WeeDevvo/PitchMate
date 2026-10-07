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
/// return the fixed, code-agnostic <see cref="Concealed"/> <c>404 Not Found</c> rather than
/// <c>403 Forbidden</c> so a non-member cannot learn whether the squad exists (Requirement 16.2); and
/// unauthenticated requests are rejected with <c>401</c> before any handler runs by the JWT bearer
/// middleware (Requirement 16.3), with <see cref="Unauthenticated"/> covering the residual case where
/// an authenticated principal carries no resolvable subject.
/// </para>
/// </summary>
internal static class SquadErrorResults
{
    // The single, code-agnostic body used for every concealed 404. Because neither the status nor the
    // body is derived from the error's Code or Message, every failure the concealing reads mask — a
    // non-member, an inactive or guest membership, an absent squad, a squad pending deletion — produces
    // a byte-for-byte identical response and cannot be told apart (Requirements 5.1, 5.2).
    private const string ConcealedTitle = "Not Found";
    private const string ConcealedDetail = "The requested resource was not found.";

    /// <summary>
    /// Maps a use case's <see cref="SquadError"/> to a <see cref="ProblemDetails"/> HTTP result. The
    /// stable <see cref="SquadErrorCode"/> is echoed in the problem's <c>title</c> and a <c>code</c>
    /// extension so clients branch on the code rather than parsing the human-readable message.
    /// </summary>
    /// <param name="error">The typed failure returned by an Application squad use case.</param>
    /// <param name="concealExistence">
    /// When <see langword="true"/> the endpoint is an existence-sensitive read: an
    /// <see cref="SquadErrorCode.Unauthorized"/> failure is reported as the code-agnostic
    /// <see cref="Concealed"/> <c>404 Not Found</c> so the squad's existence is not revealed
    /// (Requirement 16.2).
    /// </param>
    /// <returns>An <see cref="IResult"/> carrying the mapped status code and problem body.</returns>
    public static IResult ToHttpResult(SquadError error, bool concealExistence = false)
    {
        ArgumentNullException.ThrowIfNull(error);

        // Existence-concealing: on an existence-sensitive read an authorisation failure is answered by
        // the single fixed concealed 404 rather than by a 404 echoing this code. Routing it through
        // Concealed() is what keeps the response free of the `code` extension — the declared contract
        // must carry no value from which the concealed cause could be recovered (Requirements 5.2, 5.6).
        if (concealExistence && error.Code == SquadErrorCode.Unauthorized)
        {
            return Concealed();
        }

        int statusCode = error.Code switch
        {
            // Client-supplied input violated a length/enum/range policy.
            SquadErrorCode.ValidationFailed => StatusCodes.Status400BadRequest,

            // A non-expiring invite was requested where configuration forbids it.
            SquadErrorCode.ExpiryRequired => StatusCodes.Status400BadRequest,

            // The caller lacks the required role/state. On an existence-sensitive read this never
            // arrives here: it is answered above by the concealed 404 so a non-member cannot
            // distinguish "not allowed" from "does not exist".
            SquadErrorCode.Unauthorized => StatusCodes.Status403Forbidden,

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

            // The target user already holds a membership in the squad. Every reachable producer of
            // this code is a guest-claim initiation or completion, where that is a genuine rejection
            // (Requirement 6.1, 6.2) — the redemption no-op is a success carrying
            // RedeemOutcome.AlreadyMember and never reaches this seam.
            SquadErrorCode.AlreadyMember => StatusCodes.Status409Conflict,

            // Any unmapped code is a server-side oversight rather than a client error.
            _ => StatusCodes.Status500InternalServerError,
        };

        // TypedResults rather than Results: the same ProblemHttpResult, with the status/payload
        // pairing checked at compile time where it costs nothing (design D2).
        return TypedResults.Problem(
            detail: error.Message,
            statusCode: statusCode,
            title: error.Code.ToString(),
            extensions: new Dictionary<string, object?> { ["code"] = error.Code.ToString() });
    }

    /// <summary>
    /// The single existence-concealing <c>404 Not Found</c> result used by the existence-sensitive
    /// reads (Requirement 16.2). The body is a fixed, code-agnostic <c>ProblemDetails</c> — no
    /// <c>code</c> extension and no echo of the error's title or message — so every concealed
    /// rejection is byte-for-byte identical and discloses neither the squad's existence nor the cause
    /// (Requirements 5.1, 5.2).
    /// </summary>
    public static IResult Concealed() =>
        TypedResults.Problem(
            detail: ConcealedDetail,
            statusCode: StatusCodes.Status404NotFound,
            title: ConcealedTitle);

    /// <summary>
    /// The uniform unauthenticated result for a protected endpoint whose caller identity could not be
    /// resolved from the access token (Requirement 16.3). The body is deliberately empty so nothing is
    /// disclosed.
    /// </summary>
    public static IResult Unauthenticated() =>
        TypedResults.Problem(
            statusCode: StatusCodes.Status401Unauthorized,
            title: "Unauthenticated",
            detail: "Authentication is required.");
}
