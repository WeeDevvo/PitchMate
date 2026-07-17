using System.Security.Claims;
using PitchMate.Api.Auth.Endpoints;
using PitchMate.Application.Squads.UseCases;
using PitchMate.Domain.Squads;

namespace PitchMate.Api.Squads.Endpoints;

/// <summary>
/// Maps the minimal-API squad endpoints (Requirement 19.4). Every endpoint is a thin adapter: it binds
/// the request, resolves the acting user from the access token's subject claim (never a body value),
/// delegates the whole decision to an Application use-case handler, and translates the returned
/// <see cref="Result"/>/<see cref="Result{T}"/> to an HTTP result through the single
/// <see cref="SquadErrorResults"/> seam — so the Api holds no squad logic itself.
/// <para>
/// All endpoints except the pre-join invite preview require an authenticated caller. Unauthenticated
/// requests are rejected with <c>401</c> by the JWT bearer middleware before any handler runs
/// (Requirement 16.3). Authorisation and existence-concealment are decided inside the handlers and
/// mapped at the edge: existence-sensitive reads (a squad's data and its feature flags) report an
/// authorisation failure as <c>404</c> so a non-member cannot learn whether the squad exists
/// (Requirement 16.2). The pre-join preview is anonymous and discloses no squad data (Requirement 11.6).
/// </para>
/// </summary>
public static class SquadEndpoints
{
    /// <summary>
    /// Maps every squad endpoint under the <c>/squads</c> route group onto <paramref name="endpoints"/>.
    /// </summary>
    /// <param name="endpoints">The route builder to map the endpoints onto.</param>
    /// <returns>The <c>/squads</c> route group for further configuration.</returns>
    public static RouteGroupBuilder MapSquadEndpoints(this IEndpointRouteBuilder endpoints)
    {
        ArgumentNullException.ThrowIfNull(endpoints);

        RouteGroupBuilder group = endpoints.MapGroup("/squads").WithTags("Squads");

        MapSquadLifecycleEndpoints(group);
        MapRoleEndpoints(group);
        MapMembershipEndpoints(group);
        MapInviteEndpoints(group);
        MapFeatureFlagEndpoints(group);
        MapGuestEndpoints(group);
        MapGuestClaimEndpoints(group);

        return group;
    }

    /// <summary>Maps create/read/list, and the delete/reverse/export lifecycle (Requirements 1, 16, 17).</summary>
    private static void MapSquadLifecycleEndpoints(RouteGroupBuilder group)
    {
        // Create a squad the caller will own (Requirement 1).
        group.MapPost("/", static async (
            CreateSquadRequest request,
            ClaimsPrincipal principal,
            CreateSquadHandler handler,
            CancellationToken ct) =>
        {
            if (CallerIdentity.ResolveUserId(principal) is not { } userId)
            {
                return SquadErrorResults.Unauthenticated();
            }

            var command = new CreateSquadCommand(userId, request.Name, request.DisplayName);
            return ToHttpResult(await handler.HandleAsync(command, ct));
        })
            .RequireAuthorization()
            .WithName("CreateSquad");

        // List the caller's squads, excluding soft-deleted (Requirement 16.4).
        group.MapGet("/", static async (
            ClaimsPrincipal principal,
            ListMySquadsHandler handler,
            CancellationToken ct) =>
        {
            if (CallerIdentity.ResolveUserId(principal) is not { } userId)
            {
                return SquadErrorResults.Unauthenticated();
            }

            return ToHttpResult(await handler.HandleAsync(new ListMySquadsCommand(userId), ct));
        })
            .RequireAuthorization()
            .WithName("ListMySquads");

        // Read a squad's data — gated to active members; existence concealed otherwise (Requirement 16.1, 16.2).
        group.MapGet("/{squadId:guid}", static async (
            Guid squadId,
            ClaimsPrincipal principal,
            GetSquadHandler handler,
            CancellationToken ct) =>
        {
            if (CallerIdentity.ResolveUserId(principal) is not { } userId)
            {
                return SquadErrorResults.Unauthenticated();
            }

            return ToHttpResult(await handler.HandleAsync(new GetSquadCommand(userId, squadId), ct), concealExistence: true);
        })
            .RequireAuthorization()
            .WithName("GetSquad");

        // Soft-delete a squad, setting a grace purge instant (Requirement 17.1). Owner-only.
        group.MapDelete("/{squadId:guid}", static async (
            Guid squadId,
            int? gracePeriodDays,
            ClaimsPrincipal principal,
            DeleteSquadHandler handler,
            CancellationToken ct) =>
        {
            if (CallerIdentity.ResolveUserId(principal) is not { } userId)
            {
                return SquadErrorResults.Unauthenticated();
            }

            var command = new DeleteSquadCommand(userId, squadId, gracePeriodDays);
            return ToHttpResult(await handler.HandleAsync(command, ct));
        })
            .RequireAuthorization()
            .WithName("DeleteSquad");

        // Reverse a soft-deletion before the purge instant (Requirement 17.4). Owner-only.
        group.MapPost("/{squadId:guid}/restore", static async (
            Guid squadId,
            ClaimsPrincipal principal,
            ReverseSquadDeletionHandler handler,
            CancellationToken ct) =>
        {
            if (CallerIdentity.ResolveUserId(principal) is not { } userId)
            {
                return SquadErrorResults.Unauthenticated();
            }

            return ToHttpResult(await handler.HandleAsync(new ReverseSquadDeletionCommand(userId, squadId), ct));
        })
            .RequireAuthorization()
            .WithName("ReverseSquadDeletion");

        // Export a squad's data (DSAR), offered before purge (Requirement 17.2). Owner-only.
        group.MapGet("/{squadId:guid}/export", static async (
            Guid squadId,
            ClaimsPrincipal principal,
            ExportSquadHandler handler,
            CancellationToken ct) =>
        {
            if (CallerIdentity.ResolveUserId(principal) is not { } userId)
            {
                return SquadErrorResults.Unauthenticated();
            }

            return ToHttpResult(await handler.HandleAsync(new ExportSquadCommand(userId, squadId), ct));
        })
            .RequireAuthorization()
            .WithName("ExportSquad");
    }

    /// <summary>Maps promotion, demotion, and ownership transfer (Requirements 5, 6).</summary>
    private static void MapRoleEndpoints(RouteGroupBuilder group)
    {
        // Promote an active member to admin (Requirement 5.1).
        group.MapPost("/{squadId:guid}/members/{membershipId:guid}/promote", static async (
            Guid squadId,
            Guid membershipId,
            ClaimsPrincipal principal,
            PromoteToAdminHandler handler,
            CancellationToken ct) =>
        {
            if (CallerIdentity.ResolveUserId(principal) is not { } userId)
            {
                return SquadErrorResults.Unauthenticated();
            }

            var command = new PromoteToAdminCommand(userId, squadId, membershipId);
            return ToHttpResult(await handler.HandleAsync(command, ct));
        })
            .RequireAuthorization()
            .WithName("PromoteToAdmin");

        // Demote an active admin to member; never the owner (Requirement 5.3, 5.6).
        group.MapPost("/{squadId:guid}/members/{membershipId:guid}/demote", static async (
            Guid squadId,
            Guid membershipId,
            ClaimsPrincipal principal,
            DemoteToMemberHandler handler,
            CancellationToken ct) =>
        {
            if (CallerIdentity.ResolveUserId(principal) is not { } userId)
            {
                return SquadErrorResults.Unauthenticated();
            }

            var command = new DemoteToMemberCommand(userId, squadId, membershipId);
            return ToHttpResult(await handler.HandleAsync(command, ct));
        })
            .RequireAuthorization()
            .WithName("DemoteToMember");

        // Transfer ownership to an active registered member as an atomic owner/admin swap (Requirement 6.2).
        group.MapPost("/{squadId:guid}/ownership", static async (
            Guid squadId,
            TransferOwnershipRequest request,
            ClaimsPrincipal principal,
            TransferOwnershipHandler handler,
            CancellationToken ct) =>
        {
            if (CallerIdentity.ResolveUserId(principal) is not { } userId)
            {
                return SquadErrorResults.Unauthenticated();
            }

            var command = new TransferOwnershipCommand(userId, squadId, request.TargetMembershipId);
            return ToHttpResult(await handler.HandleAsync(command, ct));
        })
            .RequireAuthorization()
            .WithName("TransferOwnership");
    }

    /// <summary>Maps leaving and member removal (Requirements 7, 8).</summary>
    private static void MapMembershipEndpoints(RouteGroupBuilder group)
    {
        // Leave a squad; an owner must transfer first (Requirement 7).
        group.MapPost("/{squadId:guid}/leave", static async (
            Guid squadId,
            ClaimsPrincipal principal,
            LeaveSquadHandler handler,
            CancellationToken ct) =>
        {
            if (CallerIdentity.ResolveUserId(principal) is not { } userId)
            {
                return SquadErrorResults.Unauthenticated();
            }

            return ToHttpResult(await handler.HandleAsync(new LeaveSquadCommand(userId, squadId), ct));
        })
            .RequireAuthorization()
            .WithName("LeaveSquad");

        // Remove a member or guest; never the owner (Requirement 8).
        group.MapDelete("/{squadId:guid}/members/{membershipId:guid}", static async (
            Guid squadId,
            Guid membershipId,
            ClaimsPrincipal principal,
            RemoveMemberHandler handler,
            CancellationToken ct) =>
        {
            if (CallerIdentity.ResolveUserId(principal) is not { } userId)
            {
                return SquadErrorResults.Unauthenticated();
            }

            var command = new RemoveMemberCommand(userId, squadId, membershipId);
            return ToHttpResult(await handler.HandleAsync(command, ct));
        })
            .RequireAuthorization()
            .WithName("RemoveMember");
    }

    /// <summary>Maps invite generation, listing, revocation, redemption, and the pre-join preview (Requirements 10, 11, 12).</summary>
    private static void MapInviteEndpoints(RouteGroupBuilder group)
    {
        // Generate an invite; the link + code are returned once and only the hash is persisted (Requirement 10.1).
        group.MapPost("/{squadId:guid}/invites", static async (
            Guid squadId,
            GenerateInviteRequest request,
            ClaimsPrincipal principal,
            GenerateInviteHandler handler,
            CancellationToken ct) =>
        {
            if (CallerIdentity.ResolveUserId(principal) is not { } userId)
            {
                return SquadErrorResults.Unauthenticated();
            }

            var command = new GenerateInviteCommand(userId, squadId, request.Validity, request.NonExpiring);
            return ToHttpResult(await handler.HandleAsync(command, ct));
        })
            .RequireAuthorization()
            .WithName("GenerateInvite");

        // List a squad's invites without any redeemable secret (Requirement 10.5).
        group.MapGet("/{squadId:guid}/invites", static async (
            Guid squadId,
            ClaimsPrincipal principal,
            ListInvitesHandler handler,
            CancellationToken ct) =>
        {
            if (CallerIdentity.ResolveUserId(principal) is not { } userId)
            {
                return SquadErrorResults.Unauthenticated();
            }

            return ToHttpResult(await handler.HandleAsync(new ListInvitesCommand(userId, squadId), ct));
        })
            .RequireAuthorization()
            .WithName("ListInvites");

        // Revoke an invite; idempotent for already revoked/expired (Requirement 12.1, 12.4).
        group.MapPost("/{squadId:guid}/invites/{inviteId:guid}/revoke", static async (
            Guid squadId,
            Guid inviteId,
            ClaimsPrincipal principal,
            RevokeInviteHandler handler,
            CancellationToken ct) =>
        {
            if (CallerIdentity.ResolveUserId(principal) is not { } userId)
            {
                return SquadErrorResults.Unauthenticated();
            }

            var command = new RevokeInviteCommand(userId, squadId, inviteId);
            return ToHttpResult(await handler.HandleAsync(command, ct));
        })
            .RequireAuthorization()
            .WithName("RevokeInvite");

        // Redeem an invite to join or reactivate a membership (Requirements 9, 11). The joining user is
        // resolved from the token, and the squad is never named in the request.
        group.MapPost("/invites/redeem", static async (
            RedeemInviteRequest request,
            ClaimsPrincipal principal,
            RedeemInviteHandler handler,
            CancellationToken ct) =>
        {
            if (CallerIdentity.ResolveUserId(principal) is not { } userId)
            {
                return SquadErrorResults.Unauthenticated();
            }

            var command = new RedeemInviteCommand(userId, request.PresentedSecret, request.DisplayName);
            return ToHttpResult(await handler.HandleAsync(command, ct));
        })
            .RequireAuthorization()
            .WithName("RedeemInvite");

        // Pre-join preview: anonymous and discloses no squad data. It never touches the store or a
        // handler; it only tells the visitor that joining requires an authenticated user (Requirement 11.6).
        group.MapGet("/invites/preview", static () => Results.Ok(new InvitePreviewResponse(
                RequiresAuthentication: true,
                Message: "Sign in or create an account, then redeem your invite to join the squad.")))
            .AllowAnonymous()
            .WithName("PreviewInvite");
    }

    /// <summary>Maps reading and toggling per-squad feature flags (Requirement 13).</summary>
    private static void MapFeatureFlagEndpoints(RouteGroupBuilder group)
    {
        // Read all feature states — gated to active members; existence concealed otherwise (Requirement 13.4, 13.8).
        group.MapGet("/{squadId:guid}/features", static async (
            Guid squadId,
            ClaimsPrincipal principal,
            GetFeatureFlagsHandler handler,
            CancellationToken ct) =>
        {
            if (CallerIdentity.ResolveUserId(principal) is not { } userId)
            {
                return SquadErrorResults.Unauthenticated();
            }

            return ToHttpResult(await handler.HandleAsync(new GetFeatureFlagsCommand(userId, squadId), ct), concealExistence: true);
        })
            .RequireAuthorization()
            .WithName("GetFeatureFlags");

        // Enable or disable a single feature, leaving the others unchanged (Requirement 13.2).
        group.MapPut("/{squadId:guid}/features", static async (
            Guid squadId,
            SetFeatureFlagRequest request,
            ClaimsPrincipal principal,
            SetFeatureFlagHandler handler,
            CancellationToken ct) =>
        {
            if (CallerIdentity.ResolveUserId(principal) is not { } userId)
            {
                return SquadErrorResults.Unauthenticated();
            }

            var command = new SetFeatureFlagCommand(userId, squadId, request.Feature, request.Enabled);
            return ToHttpResult(await handler.HandleAsync(command, ct));
        })
            .RequireAuthorization()
            .WithName("SetFeatureFlag");
    }

    /// <summary>Maps guest creation and editing (Requirement 14).</summary>
    private static void MapGuestEndpoints(RouteGroupBuilder group)
    {
        // Create a guest with a lawful-basis acknowledgement and optional skill tier (Requirement 14.1).
        group.MapPost("/{squadId:guid}/guests", static async (
            Guid squadId,
            CreateGuestRequest request,
            ClaimsPrincipal principal,
            CreateGuestHandler handler,
            CancellationToken ct) =>
        {
            if (CallerIdentity.ResolveUserId(principal) is not { } userId)
            {
                return SquadErrorResults.Unauthenticated();
            }

            var command = new CreateGuestCommand(
                userId, squadId, request.DisplayName, request.SkillTier, request.LawfulBasisAcknowledged);
            return ToHttpResult(await handler.HandleAsync(command, ct));
        })
            .RequireAuthorization()
            .WithName("CreateGuest");

        // Edit a guest's display name and/or skill-tier seed (Requirements 3.2, 14).
        group.MapPatch("/{squadId:guid}/guests/{membershipId:guid}", static async (
            Guid squadId,
            Guid membershipId,
            EditGuestRequest request,
            ClaimsPrincipal principal,
            EditGuestHandler handler,
            CancellationToken ct) =>
        {
            if (CallerIdentity.ResolveUserId(principal) is not { } userId)
            {
                return SquadErrorResults.Unauthenticated();
            }

            var command = new EditGuestCommand(
                userId, squadId, membershipId, request.DisplayName, request.UpdateSkillTier, request.SkillTier);
            return ToHttpResult(await handler.HandleAsync(command, ct));
        })
            .RequireAuthorization()
            .WithName("EditGuest");
    }

    /// <summary>Maps the guest-claim lifecycle: initiate, consent, complete, reverse (Requirement 15).</summary>
    private static void MapGuestClaimEndpoints(RouteGroupBuilder group)
    {
        // Initiate a claim linking a guest membership to a registered user (Requirement 15.1, 15.7).
        group.MapPost("/{squadId:guid}/guests/{membershipId:guid}/claims", static async (
            Guid squadId,
            Guid membershipId,
            InitiateGuestClaimRequest request,
            ClaimsPrincipal principal,
            InitiateGuestClaimHandler handler,
            CancellationToken ct) =>
        {
            if (CallerIdentity.ResolveUserId(principal) is not { } userId)
            {
                return SquadErrorResults.Unauthenticated();
            }

            var command = new InitiateGuestClaimCommand(userId, squadId, membershipId, request.TargetUserId);
            return ToHttpResult(await handler.HandleAsync(command, ct));
        })
            .RequireAuthorization()
            .WithName("InitiateGuestClaim");

        // The target user records their own consent to a pending claim (Requirement 15.3).
        group.MapPost("/{squadId:guid}/guests/{membershipId:guid}/claims/consent", static async (
            Guid squadId,
            Guid membershipId,
            ClaimsPrincipal principal,
            RecordClaimConsentHandler handler,
            CancellationToken ct) =>
        {
            if (CallerIdentity.ResolveUserId(principal) is not { } userId)
            {
                return SquadErrorResults.Unauthenticated();
            }

            var command = new RecordClaimConsentCommand(userId, squadId, membershipId);
            return ToHttpResult(await handler.HandleAsync(command, ct));
        })
            .RequireAuthorization()
            .WithName("RecordClaimConsent");

        // Complete a consented claim, rebinding the guest onto its target user (Requirement 15.1, 15.2).
        group.MapPost("/{squadId:guid}/guests/{membershipId:guid}/claims/complete", static async (
            Guid squadId,
            Guid membershipId,
            ClaimsPrincipal principal,
            CompleteGuestClaimHandler handler,
            CancellationToken ct) =>
        {
            if (CallerIdentity.ResolveUserId(principal) is not { } userId)
            {
                return SquadErrorResults.Unauthenticated();
            }

            var command = new CompleteGuestClaimCommand(userId, squadId, membershipId);
            return ToHttpResult(await handler.HandleAsync(command, ct));
        })
            .RequireAuthorization()
            .WithName("CompleteGuestClaim");

        // Reverse a previously completed claim, rebinding back to a guest (Requirement 15.6, 15.8).
        group.MapPost("/{squadId:guid}/guests/{membershipId:guid}/claims/reverse", static async (
            Guid squadId,
            Guid membershipId,
            ClaimsPrincipal principal,
            ReverseGuestClaimHandler handler,
            CancellationToken ct) =>
        {
            if (CallerIdentity.ResolveUserId(principal) is not { } userId)
            {
                return SquadErrorResults.Unauthenticated();
            }

            var command = new ReverseGuestClaimCommand(userId, squadId, membershipId);
            return ToHttpResult(await handler.HandleAsync(command, ct));
        })
            .RequireAuthorization()
            .WithName("ReverseGuestClaim");
    }

    /// <summary>
    /// Translates a valueless use-case <see cref="Result"/> to <c>204 No Content</c> on success or a
    /// mapped problem result on failure.
    /// </summary>
    private static IResult ToHttpResult(Result result) =>
        result.IsSuccess ? Results.NoContent() : SquadErrorResults.ToHttpResult(result.Error!);

    /// <summary>
    /// Translates a value-bearing use-case <see cref="Result{T}"/> to <c>200 OK</c> carrying the value
    /// on success or a mapped problem result on failure. <paramref name="concealExistence"/> is passed
    /// through so existence-sensitive reads mask an authorisation failure as <c>404</c> (Requirement 16.2).
    /// </summary>
    private static IResult ToHttpResult<T>(Result<T> result, bool concealExistence = false) =>
        result.IsSuccess ? Results.Ok(result.Value) : SquadErrorResults.ToHttpResult(result.Error!, concealExistence);
}
