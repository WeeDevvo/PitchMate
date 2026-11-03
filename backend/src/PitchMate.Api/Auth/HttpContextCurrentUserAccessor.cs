using PitchMate.Api.Auth.Endpoints;
using PitchMate.Application.Common;

namespace PitchMate.Api.Auth;

/// <summary>
/// The request-scoped <see cref="ICurrentUserAccessor"/>: the signed-in user's identifier, read from
/// the validated access token on the current request through <see cref="CallerIdentity"/>, or
/// <see langword="null"/> outside a request or when the request carries no authenticated subject.
/// It replaces Infrastructure's system default, so handlers that resolve their requester through the
/// accessor (live tracking) see the caller, and save-time audit stamping records them.
/// </summary>
internal sealed class HttpContextCurrentUserAccessor(IHttpContextAccessor httpContextAccessor) : ICurrentUserAccessor
{
    /// <inheritdoc />
    public string? CurrentUserId
    {
        get
        {
            HttpContext? context = httpContextAccessor.HttpContext;
            return context is null ? null : CallerIdentity.ResolveUserId(context.User)?.ToString();
        }
    }
}
