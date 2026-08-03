using System.Security.Claims;
using PitchMate.Api.Auth.Endpoints;
using PitchMate.Application.Matches.UseCases;
using PitchMate.Domain.Matches;

namespace PitchMate.Api.Matches.Endpoints;

/// <summary>
/// Maps the minimal-API match-lifecycle endpoints (Requirement 16.4). Every endpoint is a thin
/// adapter: it binds the request, resolves the acting user from the access token's subject claim
/// (never a body value, Requirement 14.4), delegates the whole decision to an Application use-case
/// handler, and translates the returned <see cref="Result"/>/<see cref="Result{T}"/> to an HTTP
/// result through the single <see cref="MatchErrorResults"/> seam — so the Api holds no
/// match-lifecycle logic itself.
/// <para>
/// The squad-organising and availability actions are grouped under
/// <c>/squads/{squadId:guid}/matches</c> (create, availability submit/clear/tally, confirm, and
/// participant management); the per-match lifecycle actions are grouped under
/// <c>/matches/{matchId:guid}</c> (team rolling/locking, the team sheet, start, record result,
/// complete, and cancel). Match completion is addressed by a client-generated GUID v7 match id in the
/// route, so a retried completion carries the same identity (Requirement 13.1).
/// </para>
/// <para>
/// Every endpoint requires an authenticated caller; unauthenticated requests are rejected with
/// <c>401</c> by the JWT bearer middleware before any handler runs. Authorisation and
/// existence-concealment are decided inside the handlers and mapped at the edge: existence-sensitive
/// reads (the availability tally and the team sheet) report an authorisation failure as <c>404</c> so
/// a non-member cannot learn whether the match exists (Requirement 14.4).
/// </para>
/// </summary>
public static class MatchEndpoints
{
    /// <summary>
    /// Maps every match-lifecycle endpoint onto <paramref name="endpoints"/>, across the
    /// <c>/squads/{squadId:guid}/matches</c> and <c>/matches/{matchId:guid}</c> route groups.
    /// </summary>
    /// <param name="endpoints">The route builder to map the endpoints onto.</param>
    public static void MapMatchEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        RouteGroupBuilder squadScoped =
            endpoints.MapGroup("/squads/{squadId:guid}/matches").WithTags("Matches");
        MapDraftEndpoints(squadScoped);
        MapAvailabilityEndpoints(squadScoped);
        MapConfirmationEndpoints(squadScoped);
        MapParticipantEndpoints(squadScoped);

        RouteGroupBuilder matchScoped = endpoints.MapGroup("/matches/{matchId:guid}").WithTags("Matches");
        MapTeamEndpoints(matchScoped);
        MapPlayEndpoints(matchScoped);
    }

    /// <summary>Maps draft creation under the squad-scoped group (Requirement 1, 13.1).</summary>
    private static void MapDraftEndpoints(RouteGroupBuilder group)
    {
        // Create a match draft for the squad; the creating admin is resolved from the token. A
        // client-supplied GUID v7 id is retained for idempotent creation (Requirement 1.1, 13.1).
        group.MapPost("/", static async (
            Guid squadId,
            CreateMatchDraftRequest request,
            ClaimsPrincipal principal,
            CreateMatchDraftHandler handler,
            CancellationToken ct) =>
        {
            if (CallerIdentity.ResolveUserId(principal) is not { } userId)
            {
                return MatchErrorResults.Unauthenticated();
            }

            var command = new CreateMatchDraftCommand(
                userId, squadId, request.Location ?? string.Empty, request.CandidateDays ?? [], request.MatchId);
            return ToHttpResult(await handler.HandleAsync(command, ct));
        })
            .RequireAuthorization()
            .WithName("CreateMatchDraft");
    }

    /// <summary>Maps availability submit/clear/tally under the squad-scoped group (Requirements 4, 5).</summary>
    private static void MapAvailabilityEndpoints(RouteGroupBuilder group)
    {
        // Submit or replace the acting member's availability response (Requirement 4.1, 4.2).
        group.MapPut("/{matchId:guid}/availability", static async (
            Guid matchId,
            SubmitAvailabilityRequest request,
            ClaimsPrincipal principal,
            SubmitAvailabilityResponseHandler handler,
            CancellationToken ct) =>
        {
            if (CallerIdentity.ResolveUserId(principal) is not { } userId)
            {
                return MatchErrorResults.Unauthenticated();
            }

            var command = new SubmitAvailabilityResponseCommand(userId, matchId, request.MarkedDays ?? []);
            return ToHttpResult(await handler.HandleAsync(command, ct));
        })
            .RequireAuthorization()
            .WithName("SubmitAvailabilityResponse");

        // Clear the acting member's own availability response (Requirement 4.3).
        group.MapDelete("/{matchId:guid}/availability", static async (
            Guid matchId,
            ClaimsPrincipal principal,
            ClearAvailabilityResponseHandler handler,
            CancellationToken ct) =>
        {
            if (CallerIdentity.ResolveUserId(principal) is not { } userId)
            {
                return MatchErrorResults.Unauthenticated();
            }

            return ToHttpResult(await handler.HandleAsync(new ClearAvailabilityResponseCommand(userId, matchId), ct));
        })
            .RequireAuthorization()
            .WithName("ClearAvailabilityResponse");

        // Read the availability tally — gated to active members; existence concealed otherwise
        // (Requirement 5.1, 5.5, 5.6, 5.7).
        group.MapGet("/{matchId:guid}/availability/tally", static async (
            Guid matchId,
            ClaimsPrincipal principal,
            GetAvailabilityTallyHandler handler,
            CancellationToken ct) =>
        {
            if (CallerIdentity.ResolveUserId(principal) is not { } userId)
            {
                return MatchErrorResults.Unauthenticated();
            }

            return ToHttpResult(
                await handler.HandleAsync(new GetAvailabilityTallyCommand(userId, matchId), ct),
                concealExistence: true);
        })
            .RequireAuthorization()
            .WithName("GetAvailabilityTally");
    }

    /// <summary>Maps confirmation under the squad-scoped group (Requirement 6).</summary>
    private static void MapConfirmationEndpoints(RouteGroupBuilder group)
    {
        // Confirm the match on one of its candidate days (Requirement 6.1).
        group.MapPost("/{matchId:guid}/confirm", static async (
            Guid matchId,
            ConfirmMatchRequest request,
            ClaimsPrincipal principal,
            ConfirmMatchHandler handler,
            CancellationToken ct) =>
        {
            if (CallerIdentity.ResolveUserId(principal) is not { } userId)
            {
                return MatchErrorResults.Unauthenticated();
            }

            var command = new ConfirmMatchCommand(userId, matchId, request.Day);
            return ToHttpResult(await handler.HandleAsync(command, ct));
        })
            .RequireAuthorization()
            .WithName("ConfirmMatch");
    }

    /// <summary>Maps participant add/remove under the squad-scoped group (Requirement 7).</summary>
    private static void MapParticipantEndpoints(RouteGroupBuilder group)
    {
        // Add a guest participant to a confirmed match (Requirement 7.1).
        group.MapPost("/{matchId:guid}/participants", static async (
            Guid matchId,
            AddGuestParticipantRequest request,
            ClaimsPrincipal principal,
            AddGuestParticipantHandler handler,
            CancellationToken ct) =>
        {
            if (CallerIdentity.ResolveUserId(principal) is not { } userId)
            {
                return MatchErrorResults.Unauthenticated();
            }

            var command = new AddGuestParticipantCommand(userId, matchId, request.GuestMembershipId);
            return ToHttpResult(await handler.HandleAsync(command, ct));
        })
            .RequireAuthorization()
            .WithName("AddGuestParticipant");

        // Remove a registered or guest participant from a confirmed match (Requirement 7.2).
        group.MapDelete("/{matchId:guid}/participants/{membershipId:guid}", static async (
            Guid matchId,
            Guid membershipId,
            ClaimsPrincipal principal,
            RemoveParticipantHandler handler,
            CancellationToken ct) =>
        {
            if (CallerIdentity.ResolveUserId(principal) is not { } userId)
            {
                return MatchErrorResults.Unauthenticated();
            }

            var command = new RemoveParticipantCommand(userId, matchId, membershipId);
            return ToHttpResult(await handler.HandleAsync(command, ct));
        })
            .RequireAuthorization()
            .WithName("RemoveParticipant");
    }

    /// <summary>Maps team proposal, adjustment, and locking under the match-scoped group (Requirement 8).</summary>
    private static void MapTeamEndpoints(RouteGroupBuilder group)
    {
        // Request a balanced two-team proposal without changing state (Requirement 8.1).
        group.MapPost("/teams/proposal", static async (
            Guid matchId,
            ClaimsPrincipal principal,
            ProposeTeamsHandler handler,
            CancellationToken ct) =>
        {
            if (CallerIdentity.ResolveUserId(principal) is not { } userId)
            {
                return MatchErrorResults.Unauthenticated();
            }

            return ToHttpResult(await handler.HandleAsync(new ProposeTeamsCommand(userId, matchId), ct));
        })
            .RequireAuthorization()
            .WithName("ProposeTeams");

        // Move a participant between working teams (Requirement 8.3).
        group.MapPost("/teams/moves", static async (
            Guid matchId,
            MoveParticipantRequest request,
            ClaimsPrincipal principal,
            AdjustTeamsHandler handler,
            CancellationToken ct) =>
        {
            if (CallerIdentity.ResolveUserId(principal) is not { } userId)
            {
                return MatchErrorResults.Unauthenticated();
            }

            var command = new AdjustTeamsCommand(
                userId, matchId, new TeamAdjustment.MoveParticipant(request.SquadMembershipId, request.ToTeamId));
            return ToHttpResult(await handler.HandleAsync(command, ct));
        })
            .RequireAuthorization()
            .WithName("MoveParticipant");

        // Re-roll a fresh balanced assignment onto the working teams (Requirement 8.3).
        group.MapPost("/teams/reroll", static async (
            Guid matchId,
            ClaimsPrincipal principal,
            AdjustTeamsHandler handler,
            CancellationToken ct) =>
        {
            if (CallerIdentity.ResolveUserId(principal) is not { } userId)
            {
                return MatchErrorResults.Unauthenticated();
            }

            var command = new AdjustTeamsCommand(userId, matchId, new TeamAdjustment.ReRoll());
            return ToHttpResult(await handler.HandleAsync(command, ct));
        })
            .RequireAuthorization()
            .WithName("ReRollTeams");

        // Set a working team's name; a blank name draws a generated one (Requirement 8.3, 8.4).
        group.MapPut("/teams/{teamId:guid}/name", static async (
            Guid matchId,
            Guid teamId,
            SetTeamNameRequest request,
            ClaimsPrincipal principal,
            AdjustTeamsHandler handler,
            CancellationToken ct) =>
        {
            if (CallerIdentity.ResolveUserId(principal) is not { } userId)
            {
                return MatchErrorResults.Unauthenticated();
            }

            var command = new AdjustTeamsCommand(
                userId, matchId, new TeamAdjustment.SetTeamName(teamId, request.TeamName));
            return ToHttpResult(await handler.HandleAsync(command, ct));
        })
            .RequireAuthorization()
            .WithName("SetTeamName");

        // Choose the single bib-wearing working team, clearing the others (Requirement 8.3).
        group.MapPut("/teams/{teamId:guid}/bib", static async (
            Guid matchId,
            Guid teamId,
            ClaimsPrincipal principal,
            AdjustTeamsHandler handler,
            CancellationToken ct) =>
        {
            if (CallerIdentity.ResolveUserId(principal) is not { } userId)
            {
                return MatchErrorResults.Unauthenticated();
            }

            var command = new AdjustTeamsCommand(userId, matchId, new TeamAdjustment.SetBibTeam(teamId));
            return ToHttpResult(await handler.HandleAsync(command, ct));
        })
            .RequireAuthorization()
            .WithName("SetBibTeam");

        // Lock the working teams, capturing the immutable kickoff lineup (Requirement 8.5, 8.6, 8.7).
        group.MapPost("/teams/lock", static async (
            Guid matchId,
            ClaimsPrincipal principal,
            LockTeamsHandler handler,
            CancellationToken ct) =>
        {
            if (CallerIdentity.ResolveUserId(principal) is not { } userId)
            {
                return MatchErrorResults.Unauthenticated();
            }

            return ToHttpResult(await handler.HandleAsync(new LockTeamsCommand(userId, matchId), ct));
        })
            .RequireAuthorization()
            .WithName("LockTeams");

        // Read the team sheet — gated to active members; existence concealed otherwise
        // (Requirement 9.1, 9.2, 9.4, 9.5).
        group.MapGet("/team-sheet", static async (
            Guid matchId,
            ClaimsPrincipal principal,
            GetTeamSheetHandler handler,
            CancellationToken ct) =>
        {
            if (CallerIdentity.ResolveUserId(principal) is not { } userId)
            {
                return MatchErrorResults.Unauthenticated();
            }

            return ToHttpResult(
                await handler.HandleAsync(new GetTeamSheetCommand(userId, matchId), ct),
                concealExistence: true);
        })
            .RequireAuthorization()
            .WithName("GetTeamSheet");
    }

    /// <summary>Maps start, record-result, complete, and cancel under the match-scoped group (Requirements 11, 12, 13, 15).</summary>
    private static void MapPlayEndpoints(RouteGroupBuilder group)
    {
        // Start the match, transitioning TeamsRolled → InProgress (Requirement 11.1).
        group.MapPost("/start", static async (
            Guid matchId,
            ClaimsPrincipal principal,
            StartMatchHandler handler,
            CancellationToken ct) =>
        {
            if (CallerIdentity.ResolveUserId(principal) is not { } userId)
            {
                return MatchErrorResults.Unauthenticated();
            }

            return ToHttpResult(await handler.HandleAsync(new StartMatchCommand(userId, matchId), ct));
        })
            .RequireAuthorization()
            .WithName("StartMatch");

        // Record the played match's result at Basic or (feature-gated) Rich fidelity (Requirement 11).
        group.MapPost("/result", static async (
            Guid matchId,
            RecordResultRequest request,
            ClaimsPrincipal principal,
            RecordResultHandler handler,
            CancellationToken ct) =>
        {
            if (CallerIdentity.ResolveUserId(principal) is not { } userId)
            {
                return MatchErrorResults.Unauthenticated();
            }

            var command = new RecordResultCommand(userId, matchId, request.Fidelity, request.TeamScores ?? []);
            return ToHttpResult(await handler.HandleAsync(command, ct));
        })
            .RequireAuthorization()
            .WithName("RecordResult");

        // Complete the in-progress match, applying its single rating update. The client-generated
        // match id in the route makes a retried completion idempotent (Requirement 12, 13.1).
        group.MapPost("/complete", static async (
            Guid matchId,
            ClaimsPrincipal principal,
            CompleteMatchHandler handler,
            CancellationToken ct) =>
        {
            if (CallerIdentity.ResolveUserId(principal) is not { } userId)
            {
                return MatchErrorResults.Unauthenticated();
            }

            return ToHttpResult(await handler.HandleAsync(new CompleteMatchCommand(userId, matchId), ct));
        })
            .RequireAuthorization()
            .WithName("CompleteMatch");

        // Cancel the match before play; allowed only before InProgress (Requirement 15).
        group.MapPost("/cancel", static async (
            Guid matchId,
            ClaimsPrincipal principal,
            CancelMatchHandler handler,
            CancellationToken ct) =>
        {
            if (CallerIdentity.ResolveUserId(principal) is not { } userId)
            {
                return MatchErrorResults.Unauthenticated();
            }

            return ToHttpResult(await handler.HandleAsync(new CancelMatchCommand(userId, matchId), ct));
        })
            .RequireAuthorization()
            .WithName("CancelMatch");
    }

    /// <summary>
    /// Translates a valueless use-case <see cref="Result"/> to <c>204 No Content</c> on success or a
    /// mapped problem result on failure.
    /// </summary>
    private static IResult ToHttpResult(Result result) =>
        result.IsSuccess ? Results.NoContent() : MatchErrorResults.ToHttpResult(result.Error!);

    /// <summary>
    /// Translates a value-bearing use-case <see cref="Result{T}"/> to <c>200 OK</c> carrying the value
    /// on success or a mapped problem result on failure. <paramref name="concealExistence"/> is passed
    /// through so existence-sensitive reads mask an authorisation failure as <c>404</c>
    /// (Requirement 14.4).
    /// </summary>
    private static IResult ToHttpResult<T>(Result<T> result, bool concealExistence = false) =>
        result.IsSuccess ? Results.Ok(result.Value) : MatchErrorResults.ToHttpResult(result.Error!, concealExistence);
}
