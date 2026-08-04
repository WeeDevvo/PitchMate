using System.Security.Claims;
using PitchMate.Api.Auth.Endpoints;
using PitchMate.Application.Stats;

namespace PitchMate.Api.Stats.Endpoints;

/// <summary>
/// Maps the minimal-API stats read endpoints — the squad <c>Leaderboard</c> and a per-player
/// <c>Profile</c> (Requirement 15.4). Every endpoint is a thin adapter: it binds the route/query,
/// resolves the acting user <b>only</b> from the access token's subject claim via
/// <see cref="CallerIdentity"/> (never a body or query value, Requirement 1.5), delegates the whole
/// decision to an Application use-case handler, and translates the returned
/// <see cref="Result{T}"/> to an HTTP result through the single <see cref="StatsErrorResults"/> seam —
/// so the Api holds no stats aggregation or derivation logic itself.
/// <para>
/// The reads are existence-concealing and therefore do <b>not</b> use
/// <see cref="AuthorizationEndpointConventionBuilderExtensions.RequireAuthorization"/>: a missing,
/// malformed, or expired token leaves an unauthenticated principal that resolves to no subject, and
/// the endpoint answers with the same byte-for-byte <c>404</c> as a genuinely non-existent squad or
/// membership via <see cref="StatsErrorResults.Concealed"/> (Requirement 1.6). Member/subject
/// authorisation and its concealment for an authenticated non-member are decided inside the handlers
/// and mapped at the edge (Requirements 1.1, 1.2, 3.6). The response contracts are the Application
/// read models themselves (<see cref="Leaderboard"/>, <see cref="PlayerProfile"/>), surfaced through
/// the OpenAPI document so the generated TS client never recomputes statistics locally
/// (Requirements 15.5, 15.6).
/// </para>
/// </summary>
public static class StatsEndpoints
{
    /// <summary>
    /// Maps the squad-scoped stats endpoints under the <c>/squads</c> route group onto
    /// <paramref name="endpoints"/>.
    /// </summary>
    /// <param name="endpoints">The route builder to map the endpoints onto.</param>
    /// <returns>The <c>/squads</c> route group for further configuration.</returns>
    public static RouteGroupBuilder MapStatsEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        RouteGroupBuilder group = endpoints.MapGroup("/squads").WithTags("Stats");

        // Squad leaderboard ranked by a single selected statistic (Requirement 4.1). The statistic is a
        // query value; an unrecognised value is passed through as an undefined enum so the handler owns
        // the "unsupported statistic" decision and returns 400 (Requirement 4.7).
        group.MapGet("/{squadId:guid}/leaderboard", static async (
            Guid squadId,
            string? statistic,
            ClaimsPrincipal principal,
            GetLeaderboardHandler handler,
            CancellationToken ct) =>
        {
            if (CallerIdentity.ResolveUserId(principal) is not { } userId)
            {
                return StatsErrorResults.Concealed();
            }

            var command = new GetLeaderboardCommand(userId, squadId, ParseStatistic(statistic));
            return ToHttpResult(await handler.HandleAsync(command, ct));
        })
            .WithName("GetSquadLeaderboard");

        // Per-player profile scoped to the squad, for registered members and guests alike, regardless of
        // the subject's membership state (Requirement 3.1). A subject in another squad is concealed as a
        // 404 by the handler → seam (Requirement 3.6).
        group.MapGet("/{squadId:guid}/members/{membershipId:guid}/profile", static async (
            Guid squadId,
            Guid membershipId,
            ClaimsPrincipal principal,
            GetPlayerProfileHandler handler,
            CancellationToken ct) =>
        {
            if (CallerIdentity.ResolveUserId(principal) is not { } userId)
            {
                return StatsErrorResults.Concealed();
            }

            var command = new GetPlayerProfileCommand(userId, squadId, membershipId);
            return ToHttpResult(await handler.HandleAsync(command, ct));
        })
            .WithName("GetPlayerProfile");

        return group;
    }

    /// <summary>
    /// Parses the requested ranking statistic from its query representation. A value that does not name
    /// a supported <see cref="LeaderboardStatistic"/> is mapped to an undefined enum value so that
    /// <see cref="GetLeaderboardHandler"/> — the single authority on the supported set — rejects it with
    /// <see cref="StatsErrorCode.UnsupportedStatistic"/> (Requirement 4.7), rather than the edge failing
    /// the bind and short-circuiting that decision.
    /// </summary>
    private static LeaderboardStatistic ParseStatistic(string? statistic) =>
        Enum.TryParse(statistic, ignoreCase: true, out LeaderboardStatistic parsed) && Enum.IsDefined(parsed)
            ? parsed
            : (LeaderboardStatistic)(-1);

    /// <summary>
    /// Translates a value-bearing stats <see cref="Result{T}"/> to <c>200 OK</c> carrying the read model
    /// on success or a mapped problem result on failure via the existence-concealing
    /// <see cref="StatsErrorResults"/> seam.
    /// </summary>
    private static IResult ToHttpResult<T>(Result<T> result) =>
        result.IsSuccess ? Results.Ok(result.Value) : StatsErrorResults.ToHttpResult(result.Error!);
}
