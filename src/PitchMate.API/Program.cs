using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using PitchMate.Application.Commands.Users;
using PitchMate.Application.Services;
using PitchMate.Domain.Repositories;
using PitchMate.Domain.Services;
using PitchMate.Infrastructure.Data;
using PitchMate.Infrastructure.Repositories;
using PitchMate.Infrastructure.Services;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddControllers();

// Configure JWT Authentication
var jwtSettings = builder.Configuration.GetSection("Jwt");
var secretKey = jwtSettings["SecretKey"] ?? throw new InvalidOperationException("JWT SecretKey is not configured.");
var issuer = jwtSettings["Issuer"] ?? "PitchMate";
var audience = jwtSettings["Audience"] ?? "PitchMate";
var expirationMinutes = int.Parse(jwtSettings["ExpirationMinutes"] ?? "60");

builder.Services.AddAuthentication(options =>
{
    options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
    options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
})
.AddJwtBearer(options =>
{
    options.TokenValidationParameters = new TokenValidationParameters
    {
        ValidateIssuer = true,
        ValidateAudience = true,
        ValidateLifetime = true,
        ValidateIssuerSigningKey = true,
        ValidIssuer = issuer,
        ValidAudience = audience,
        IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secretKey)),
        ClockSkew = TimeSpan.Zero,
        NameClaimType = "sub" // Map the "sub" claim to ClaimTypes.NameIdentifier
    };
});

builder.Services.AddAuthorization();

// Add memory cache for configuration service
builder.Services.AddMemoryCache();

// Register DbContext
var connectionString = builder.Configuration.GetConnectionString("DefaultConnection") 
    ?? "Host=localhost;Database=pitchmate;Username=postgres;Password=postgres";
builder.Services.AddDbContext<PitchMateDbContext>(options =>
    options.UseNpgsql(connectionString));

// Register repositories
builder.Services.AddScoped<IUserRepository, UserRepository>();
builder.Services.AddScoped<ISquadRepository, SquadRepository>();
builder.Services.AddScoped<IMatchRepository, MatchRepository>();

// Register domain services
builder.Services.AddScoped<ITeamBalancingService, TeamBalancingService>();
builder.Services.AddScoped<IEloCalculationService, EloCalculationService>();

// Register application services
builder.Services.AddScoped<IJwtTokenService>(sp => 
    new JwtTokenService(secretKey, issuer, audience, expirationMinutes));
builder.Services.AddScoped<IConfigurationService, ConfigurationService>();
builder.Services.AddScoped<IGoogleTokenValidator, GoogleTokenValidator>();

// Register command handlers
builder.Services.AddScoped<CreateUserCommandHandler>();
builder.Services.AddScoped<AuthenticateUserCommandHandler>();
builder.Services.AddScoped<AuthenticateWithGoogleCommandHandler>();

// Register squad command handlers
builder.Services.AddScoped<PitchMate.Application.Commands.Squads.CreateSquadCommandHandler>();
builder.Services.AddScoped<PitchMate.Application.Commands.Squads.JoinSquadCommandHandler>();
builder.Services.AddScoped<PitchMate.Application.Commands.Squads.AddSquadAdminCommandHandler>();
builder.Services.AddScoped<PitchMate.Application.Commands.Squads.RemoveSquadMemberCommandHandler>();

// Register match command handlers
builder.Services.AddScoped<PitchMate.Application.Commands.Matches.CreateMatchCommandHandler>();
builder.Services.AddScoped<PitchMate.Application.Commands.Matches.RecordMatchResultCommandHandler>();

// Register query handlers
builder.Services.AddScoped<PitchMate.Application.Queries.GetUserSquadsQueryHandler>();
builder.Services.AddScoped<PitchMate.Application.Queries.GetSquadMatchesQueryHandler>();
builder.Services.AddScoped<PitchMate.Application.Queries.GetUserRatingInSquadQueryHandler>();

// Learn more about configuring Swagger/OpenAPI at https://aka.ms/aspnetcore/swashbuckle
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var app = builder.Build();

// Seed database if --seed argument is provided
if (args.Contains("--seed"))
{
    using var scope = app.Services.CreateScope();
    var context = scope.ServiceProvider.GetRequiredService<PitchMateDbContext>();
    await DatabaseSeeder.SeedAsync(context);
    Console.WriteLine("Database seeded successfully.");
    return; // Exit after seeding
}

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseHttpsRedirection();

app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();

app.Run();

// Make Program class accessible for testing
public partial class Program { }

