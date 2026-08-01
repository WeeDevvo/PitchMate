using System.Security.Claims;
using PitchMate.Api.Auth.Endpoints;
using PitchMate.Application.Notifications;
using Result = PitchMate.Domain.Notifications.Result;

namespace PitchMate.Api.Notifications.Endpoints;

/// <summary>
/// Maps the minimal-API notification read-model endpoints (Requirements 9.1, 9.3, 9.5, 9.6, 13.4). Every
/// endpoint is a thin adapter: it binds the request, resolves the acting user from the access token's
/// subject claim (never a body value), delegates the whole decision to an Application read-model handler,
/// and translates the returned <see cref="Result"/>/<see cref="PitchMate.Domain.Notifications.Result{T}"/>
/// to an HTTP result through the single <see cref="NotificationErrorResults"/> seam — so the Api holds no
/// notification/entity/use-case/mapping logic itself.
/// <para>
/// All endpoints require an authenticated caller. Unauthenticated requests are rejected with <c>401</c>
/// by the JWT bearer middleware before any handler runs (Requirement 10.2), with
/// <see cref="NotificationErrorResults.Unauthenticated"/> covering the residual case where an
/// authenticated principal carries no resolvable subject. Ownership and squad-scope authorisation, and
/// their non-disclosing <c>404</c> concealment, are decided inside the handlers and mapped at the edge
/// (Requirements 10.1, 10.3, 10.4, 10.5).
/// </para>
/// </summary>
public static class NotificationEndpoints
{
    /// <summary>
    /// Maps every notification endpoint under the <c>/notifications</c> route group onto
    /// <paramref name="endpoints"/>.
    /// </summary>
    /// <param name="endpoints">The route builder to map the endpoints onto.</param>
    /// <returns>The <c>/notifications</c> route group for further configuration.</returns>
    public static RouteGroupBuilder MapNotificationEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        RouteGroupBuilder group = endpoints.MapGroup("/notifications").WithTags("Notifications");

        // List the caller's own notifications, optionally scoped to a single squad (Requirements 9.1, 9.4).
        group.MapGet("/", static async (
            Guid? squadId,
            ClaimsPrincipal principal,
            ListNotificationsHandler handler,
            CancellationToken ct) =>
        {
            if (CallerIdentity.ResolveUserId(principal) is not { } userId)
            {
                return NotificationErrorResults.Unauthenticated();
            }

            var command = new ListNotificationsCommand(userId, squadId);
            return ToHttpResult(await handler.HandleAsync(command, ct));
        })
            .RequireAuthorization()
            .WithName("ListNotifications");

        // Count the caller's own unread notifications, optionally scoped to a single squad (Requirements 9.3, 9.4).
        group.MapGet("/unread-count", static async (
            Guid? squadId,
            ClaimsPrincipal principal,
            GetUnreadCountHandler handler,
            CancellationToken ct) =>
        {
            if (CallerIdentity.ResolveUserId(principal) is not { } userId)
            {
                return NotificationErrorResults.Unauthenticated();
            }

            var command = new GetUnreadCountCommand(userId, squadId);
            return ToHttpResult(await handler.HandleAsync(command, ct));
        })
            .RequireAuthorization()
            .WithName("GetUnreadNotificationCount");

        // Mark one of the caller's own notifications read; idempotent and non-disclosing (Requirement 9.5).
        group.MapPost("/{notificationId:guid}/read", static async (
            Guid notificationId,
            ClaimsPrincipal principal,
            MarkNotificationReadHandler handler,
            CancellationToken ct) =>
        {
            if (CallerIdentity.ResolveUserId(principal) is not { } userId)
            {
                return NotificationErrorResults.Unauthenticated();
            }

            var command = new MarkNotificationReadCommand(userId, notificationId);
            return ToHttpResult(await handler.HandleAsync(command, ct));
        })
            .RequireAuthorization()
            .WithName("MarkNotificationRead");

        // Mark all the caller's own unread notifications read, optionally squad-scoped, returning the
        // number changed (Requirements 9.6, 9.7).
        group.MapPost("/read-all", static async (
            Guid? squadId,
            ClaimsPrincipal principal,
            MarkAllNotificationsReadHandler handler,
            CancellationToken ct) =>
        {
            if (CallerIdentity.ResolveUserId(principal) is not { } userId)
            {
                return NotificationErrorResults.Unauthenticated();
            }

            var command = new MarkAllNotificationsReadCommand(userId, squadId);
            return ToHttpResult(await handler.HandleAsync(command, ct));
        })
            .RequireAuthorization()
            .WithName("MarkAllNotificationsRead");

        return group;
    }

    /// <summary>
    /// Translates a valueless notification <see cref="Result"/> to <c>204 No Content</c> on success or a
    /// mapped problem result on failure.
    /// </summary>
    private static IResult ToHttpResult(Result result) =>
        result.IsSuccess ? Results.NoContent() : NotificationErrorResults.ToHttpResult(result.Error!);

    /// <summary>
    /// Translates a value-bearing notification <see cref="PitchMate.Domain.Notifications.Result{T}"/> to
    /// <c>200 OK</c> carrying the value on success or a mapped problem result on failure.
    /// </summary>
    private static IResult ToHttpResult<T>(PitchMate.Domain.Notifications.Result<T> result) =>
        result.IsSuccess ? Results.Ok(result.Value) : NotificationErrorResults.ToHttpResult(result.Error!);
}
