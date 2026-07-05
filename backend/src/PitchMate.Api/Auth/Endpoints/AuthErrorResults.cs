using PitchMate.Application.Auth;

namespace PitchMate.Api.Auth.Endpoints;

/// <summary>
/// The single translation seam from an Application <see cref="AuthError"/> to an HTTP result
/// (Requirements 12.4, 12.5). Every auth endpoint delegates its authentication decision to an
/// Application use case and, on failure, hands the returned <see cref="AuthError"/> to this helper —
/// so the Api holds no authentication logic and every <see cref="AuthErrorCode"/> maps to exactly one
/// HTTP status in one place.
/// </summary>
internal static class AuthErrorResults
{
    /// <summary>
    /// Maps a use case's <see cref="AuthError"/> to a <see cref="ProblemDetails"/> HTTP result. The
    /// stable <see cref="AuthErrorCode"/> is echoed in the problem's <c>title</c> and a <c>code</c>
    /// extension so clients branch on the code rather than parsing the human-readable message.
    /// </summary>
    /// <param name="error">The typed failure returned by an Application auth use case.</param>
    /// <returns>An <see cref="IResult"/> carrying the mapped status code and problem body.</returns>
    public static IResult ToHttpResult(AuthError error)
    {
        ArgumentNullException.ThrowIfNull(error);

        int statusCode = error.Code switch
        {
            // Client-supplied input was structurally invalid.
            AuthErrorCode.ValidationFailed => StatusCodes.Status400BadRequest,
            AuthErrorCode.InvalidEmail => StatusCodes.Status400BadRequest,
            AuthErrorCode.PasswordPolicy => StatusCodes.Status400BadRequest,

            // A presented opaque token (refresh, verification, or reset) was invalid or expired.
            // OAuth treats a bad refresh grant as a 400, and the same applies to redeem flows.
            AuthErrorCode.TokenInvalid => StatusCodes.Status400BadRequest,
            AuthErrorCode.TokenExpired => StatusCodes.Status400BadRequest,

            // Credentials or a session were required and not satisfied. Kept deliberately generic so
            // existing and non-existing accounts are indistinguishable (Requirement 6.2).
            AuthErrorCode.AuthenticationFailed => StatusCodes.Status401Unauthorized,
            AuthErrorCode.Unauthenticated => StatusCodes.Status401Unauthorized,

            // The caller is authenticated but the account state forbids the operation.
            AuthErrorCode.EmailNotVerified => StatusCodes.Status403Forbidden,

            // The referenced user does not exist.
            AuthErrorCode.UserNotFound => StatusCodes.Status404NotFound,

            // A uniqueness or last-of-its-kind rule was violated.
            AuthErrorCode.EmailAlreadyRegistered => StatusCodes.Status409Conflict,
            AuthErrorCode.DuplicateIdentity => StatusCodes.Status409Conflict,
            AuthErrorCode.IdentityAlreadyLinked => StatusCodes.Status409Conflict,
            AuthErrorCode.PasswordMethodExists => StatusCodes.Status409Conflict,
            AuthErrorCode.LastIdentity => StatusCodes.Status409Conflict,

            // A downstream email transport failed after its retry budget.
            AuthErrorCode.DeliveryFailed => StatusCodes.Status502BadGateway,

            // Any unmapped code is a server-side oversight rather than a client error.
            _ => StatusCodes.Status500InternalServerError,
        };

        return Results.Problem(
            detail: error.Message,
            statusCode: statusCode,
            title: error.Code.ToString(),
            extensions: new Dictionary<string, object?> { ["code"] = error.Code.ToString() });
    }
}
