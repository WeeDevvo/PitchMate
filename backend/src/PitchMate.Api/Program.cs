using PitchMate.Api.Auth;
using PitchMate.Api.Auth.Endpoints;
using PitchMate.Api.Auth.OpenApi;
using PitchMate.Api.LiveTracking;
using PitchMate.Api.LiveTracking.Endpoints;
using PitchMate.Api.Matches;
using PitchMate.Api.Matches.Endpoints;
using PitchMate.Api.Notifications;
using PitchMate.Api.Notifications.Endpoints;
using PitchMate.Api.Squads;
using PitchMate.Api.Squads.Endpoints;
using PitchMate.Api.Stats;
using PitchMate.Api.Stats.Endpoints;
using PitchMate.Infrastructure;

var builder = WebApplication.CreateBuilder(args);

// Fail fast on misconfigured DI: validate the container when the host is built and enforce
// scope correctness so missing or mis-scoped registrations surface at startup (Req 7.6).
builder.Host.UseDefaultServiceProvider((context, options) =>
{
    options.ValidateOnBuild = true;
    options.ValidateScopes = true;
});

// OpenAPI document (consumed to generate the typed TS client in packages/api-client). The auth
// transformers declare the bearer security scheme and mark which endpoints require it (Requirement 13.7).
builder.Services.AddOpenApi(options =>
{
    options.AddDocumentTransformer<BearerSecuritySchemeDocumentTransformer>();
    options.AddOperationTransformer<BearerSecurityRequirementOperationTransformer>();
});

builder.Services.AddInfrastructure(builder.Configuration);

// Auth composition root: binds and validates the Auth configuration (fail-fast at startup),
// selects the email sender, and registers the auth use cases and their Infrastructure
// implementations (Requirements 11.7, 12.6, 15).
builder.Services.AddAuth(builder.Configuration);

// Squads composition root: binds the Squads:Invites options, registers the squad use cases, and
// wires their Infrastructure implementations behind the Application abstractions (Requirement 19.4).
builder.Services.AddSquads(builder.Configuration);

// Notifications composition root: registers the publish fan-out, the read-model handlers, and the
// lifecycle removals, and wires their Infrastructure implementations behind the Application
// abstractions. Best-effort email reuses the single IEmailSender registered by AddAuth — no second
// transport is introduced (Requirements 7.2, 13.3, 13.4, 13.6).
builder.Services.AddNotifications();

// Matches composition root: registers the match-lifecycle use-case handlers so every match endpoint
// resolves its handler. The match Infrastructure implementations (repositories, team balancer, silly
// name generator) are already wired by AddInfrastructure, since they are internal to that assembly
// (Requirement 16.4).
builder.Services.AddMatches();

// Stats composition root: registers the stats read use-case handlers (leaderboard and player
// profile) so every stats endpoint resolves its handler. The stats Infrastructure implementations
// (EfStatsRepository, the display-rating parameters source, and the rich-stats source) are already
// wired by AddInfrastructure, since they are internal to that assembly (Requirement 15.4).
builder.Services.AddStats();

// Live-tracking composition root: registers the live-tracking use-case handlers (record event batch,
// finalise tracked result, and read running score) so every live-tracking endpoint resolves its
// handler. The live-tracking Infrastructure implementations (EfMatchEventRepository and the
// event-log-backed EventLogRichStatsSource) are already wired by AddInfrastructure, since they are
// internal to that assembly (Requirement 14.4).
builder.Services.AddLiveTracking();

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseHttpsRedirection();

// Authentication then authorization, before the endpoints they guard. The JWT bearer handler
// establishes the caller principal; authorization enforces RequireAuthorization()/AllowAnonymous()
// so protected endpoints yield a uniform 401 for missing/invalid tokens (Requirements 13.3–13.5).
app.UseAuthentication();
app.UseAuthorization();

// Basic liveness probe. Real endpoints arrive with feature specs.
app.MapGet("/health", () => Results.Ok(new { status = "ok" }))
   .WithName("HealthCheck");

// Auth endpoints: public sign-in/registration/verification flows plus the protected
// linking, account, and GDPR operations (Requirement 13). Each endpoint delegates to an
// Application use case and maps failures through the single AuthErrorCode → HTTP seam.
app.MapAuthEndpoints();

// Squad endpoints: squad create/read/list, role and ownership actions, leave/removal, invites
// (generate/list/revoke/redeem plus the anonymous pre-join preview), feature flags, guests, guest
// claims, and the delete/reverse/export lifecycle (Requirement 19.4). Each endpoint delegates to an
// Application use case and maps failures through the single SquadErrorCode → HTTP seam.
app.MapSquadEndpoints();

// Notification endpoints: the authenticated read model — list, unread-count, mark-one-read, and
// mark-all-read (optionally squad-scoped) (Requirements 9.1, 9.3, 9.5, 9.6). Each endpoint delegates to
// an Application read-model handler and maps failures through the single NotificationErrorCode → HTTP
// seam, concealing existence with a uniform 404 (Requirements 10.1–10.5, 13.4).
app.MapNotificationEndpoints();

// Match endpoints: the full lifecycle — draft create, availability submit/clear/tally, confirm,
// participant add/remove, team roll/adjust/lock and the team sheet, then start, record result,
// complete, and cancel (Requirement 16.4). Each endpoint delegates to an Application use case and
// maps failures through the single MatchErrorCode → HTTP seam, concealing existence with a uniform
// 404 on existence-sensitive reads (Requirement 14.4).
app.MapMatchEndpoints();

// Stats endpoints: the two squad-scoped reads — the leaderboard ranked by a selected statistic and a
// per-player profile (Requirement 15.4). Each endpoint resolves the acting user from the token
// subject, delegates to an Application read use case, and maps failures through the single
// existence-concealing StatsErrorCode → HTTP seam, answering a missing/invalid token and an
// authenticated non-member with a uniform 404 (Requirements 1.2, 1.6, 3.6).
app.MapStatsEndpoints();

// Live-tracking endpoints: the match-scoped tracking surface — record an Event_Batch, finalise the
// tracked result, and read the current running score (Requirement 14.4). Each endpoint delegates to an
// Application use case and maps failures through the single existence-concealing
// LiveTrackingErrorResults seam, concealing existence with a uniform 404 for a non-member or a missing
// match (Requirements 11.1, 11.2, 11.4).
app.MapLiveTrackingEndpoints();

app.Run();

/// <summary>
/// Explicit program entry-point marker. Declared <c>public partial</c> so integration tests can
/// reference it as the <c>TEntryPoint</c> for <c>WebApplicationFactory&lt;Program&gt;</c> and boot the
/// real Api in-memory; it changes no runtime behaviour.
/// </summary>
public partial class Program;
