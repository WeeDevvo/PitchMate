using PitchMate.Infrastructure;

var builder = WebApplication.CreateBuilder(args);

// OpenAPI document (consumed to generate the typed TS client in packages/api-client).
builder.Services.AddOpenApi();

builder.Services.AddInfrastructure(builder.Configuration);

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseHttpsRedirection();

// Basic liveness probe. Real endpoints arrive with feature specs.
app.MapGet("/health", () => Results.Ok(new { status = "ok" }))
   .WithName("HealthCheck");

app.Run();
