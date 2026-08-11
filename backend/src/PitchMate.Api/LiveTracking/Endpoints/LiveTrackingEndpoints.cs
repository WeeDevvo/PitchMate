using PitchMate.Application.LiveTracking.UseCases;
using PitchMate.Domain.LiveTracking;

namespace PitchMate.Api.LiveTracking.Endpoints;

/// <summary>
/// Maps the minimal-API live-tracking endpoints (Requirement 11, 13.1) under the match-scoped
/// <c>/matches/{matchId:guid}</c> route group: recording an <c>Event_Batch</c>
/// (<c>POST /events</c>), finalising the tracked result (<c>POST /tracked-result</c>), and reading the
/// current running score (<c>GET /running-score</c>). Every endpoint is a thin adapter: it binds the
/// route and (for recording) the request body, delegates the whole decision to an Application use-case
/// handler, and translates the returned <see cref="Result{T}"/> to an HTTP result through the single
/// <see cref="LiveTrackingErrorResults"/> seam — so the Api holds no live-tracking recording,
/// derivation, or rating logic itself (Requirement 14.4).
/// <para>
/// The acting user is resolved <b>only</b> from the authenticated access token's subject, never from a
/// body or query value: each handler reads the requester from <c>ICurrentUserAccessor</c> — populated
/// from the validated bearer token — and authorises it against the match's squad, so the commands carry
/// only the target match (and, for recording, the submitted events). Every endpoint requires an
/// authenticated caller; a missing or invalid token is rejected with a uniform <c>401</c> by the JWT
/// bearer middleware before any handler runs. Authorisation and existence-concealment are decided
/// inside the handlers and mapped at the edge: an authenticated non-member — or any request for a match
/// that does not exist — is answered with a byte-for-byte identical <c>404</c> so a caller cannot learn
/// whether another squad's match exists (Requirement 11.1, 11.2, 11.4).
/// </para>
/// <para>
/// Recording returns <c>200</c> carrying the <see cref="BatchResultResponse"/> even when some submitted
/// events were classified <c>Duplicate</c> or <c>Rejected</c>: those are per-event outcomes carried in
/// the batch body, not failures of the request as a whole. Only a whole-request failure — an
/// authorisation failure, the squad's <c>LiveMatchTracking</c> flag being off, a match outside the
/// trackable window, or an empty batch — is mapped to a non-<c>200</c> result through the error seam
/// (Requirement 2.1, 2.4, 2.6, 7, 9.1).
/// </para>
/// </summary>
public static class LiveTrackingEndpoints
{
    /// <summary>
    /// Maps every live-tracking endpoint onto <paramref name="endpoints"/>, under the match-scoped
    /// <c>/matches/{matchId:guid}</c> route group.
    /// </summary>
    /// <param name="endpoints">The route builder to map the endpoints onto.</param>
    public static void MapLiveTrackingEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        RouteGroupBuilder group =
            endpoints.MapGroup("/matches/{matchId:guid}").WithTags("Live Tracking");

        // Record an Event_Batch of one or more events against the match. Each event is classified
        // independently as Applied/Duplicate/Rejected and the ordered outcomes ride in the 200 body,
        // so a per-event Duplicate/Rejected never fails the request; only a whole-request failure maps
        // through the error seam (Requirement 1, 2). The acting admin is resolved from the token.
        group.MapPost("/events", static async (
            Guid matchId,
            EventBatchRequest request,
            RecordEventBatchHandler handler,
            CancellationToken ct) =>
        {
            ArgumentNullException.ThrowIfNull(request);

            var command = new RecordEventBatchCommand(matchId, request.ToSubmissions());
            return ToHttpResult(await handler.HandleAsync(command, ct), BatchResultResponse.From);
        })
            .RequireAuthorization()
            .WithName("RecordMatchEvents");

        // Finalise the tracked result while the match is InProgress: derive the Rich result from the
        // running score and drive match-lifecycle completion, which owns the single idempotent rating
        // update (Requirement 8). The acting admin is resolved from the token.
        group.MapPost("/tracked-result", static async (
            Guid matchId,
            FinaliseTrackedResultHandler handler,
            CancellationToken ct) =>
        {
            var command = new FinaliseTrackedResultCommand(matchId);
            return ToHttpResult(await handler.HandleAsync(command, ct), FinaliseTrackedResultResponse.From);
        })
            .RequireAuthorization()
            .WithName("FinaliseTrackedResult");

        // Read the match's current running score, derived from the effective events at request time and
        // gated to active squad members; a non-member is concealed as a 404 (Requirement 6.1, 11.3,
        // 11.4, 13.3). The acting member is resolved from the token.
        group.MapGet("/running-score", static async (
            Guid matchId,
            GetRunningScoreHandler handler,
            CancellationToken ct) =>
        {
            var command = new GetRunningScoreCommand(matchId);
            return ToHttpResult(await handler.HandleAsync(command, ct), RunningScoreResponse.From);
        })
            .RequireAuthorization()
            .WithName("GetMatchRunningScore");
    }

    /// <summary>
    /// Translates a value-bearing live-tracking <see cref="Result{T}"/> to <c>200 OK</c> carrying the
    /// mapped response on success, or a mapped problem result on a whole-request failure through the
    /// single existence-concealing <see cref="LiveTrackingErrorResults"/> seam.
    /// </summary>
    /// <typeparam name="TValue">The Application result value type.</typeparam>
    /// <typeparam name="TResponse">The transport response type returned on success.</typeparam>
    /// <param name="result">The use case's result.</param>
    /// <param name="toResponse">Projects the successful value onto its response shape.</param>
    private static IResult ToHttpResult<TValue, TResponse>(
        Result<TValue> result,
        Func<TValue, TResponse> toResponse) =>
        result.IsSuccess
            ? Results.Ok(toResponse(result.Value!))
            : LiveTrackingErrorResults.ToHttpResult(result.Error!);
}
