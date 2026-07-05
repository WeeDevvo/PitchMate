using PitchMate.Api.Auth;
using PitchMate.Api.Auth.Endpoints;
using PitchMate.Api.Auth.OpenApi;
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

app.Run();

/// <summary>
/// Explicit program entry-point marker. Declared <c>public partial</c> so integration tests can
/// reference it as the <c>TEntryPoint</c> for <c>WebApplicationFactory&lt;Program&gt;</c> and boot the
/// real Api in-memory; it changes no runtime behaviour.
/// </summary>
public partial class Program;
