using System.Security.Claims;

namespace PitchMate.Api.Auth.Endpoints;

/// <summary>
/// Resolves the calling <c>User</c> identity from the authenticated principal on a protected endpoint
/// (Requirement 13.1). The access token carries the user's identifier in its <c>sub</c> claim
/// (mirrored onto <see cref="ClaimTypes.NameIdentifier"/> by the default JWT claim mapping), so the
/// caller identity is derived from the validated token rather than any client-supplied body value.
/// </summary>
internal static class CallerIdentity
{
    // The JWT registered "subject" claim carrying the User's identifier. Declared as a literal so the
    // Api takes no dependency on the token library that lives in Infrastructure (Requirement 12.4).
    private const string SubjectClaimType = "sub";

    /// <summary>
    /// Extracts the authenticated user's identifier from <paramref name="principal"/>, or
    /// <see langword="null"/> when no authenticated subject is present or the subject is not a GUID.
    /// </summary>
    /// <param name="principal">The principal established by the authentication middleware.</param>
    /// <returns>The resolved user identifier, or <see langword="null"/> when unresolved.</returns>
    public static Guid? ResolveUserId(ClaimsPrincipal principal)
    {
        ArgumentNullException.ThrowIfNull(principal);

        string? subject = principal.FindFirstValue(SubjectClaimType)
            ?? principal.FindFirstValue(ClaimTypes.NameIdentifier);

        return Guid.TryParse(subject, out Guid userId) ? userId : null;
    }
}
