using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace PitchMate.Infrastructure.Persistence;

/// <summary>
/// Design-time factory used by the EF Core tooling (<c>dotnet ef migrations add</c>,
/// <c>dotnet ef migrations script</c>, etc.) to construct a <see cref="PitchMateDbContext"/>
/// outside the running application's dependency-injection container.
/// <para>
/// The factory mirrors the runtime registration in
/// <see cref="DependencyInjection.AddInfrastructure"/> — Npgsql with the snake_case naming
/// convention — so scaffolded migrations reflect the same mapping conventions the application
/// uses. A placeholder connection string is supplied because migration scaffolding only needs
/// the model, never a live database connection.
/// </para>
/// </summary>
public sealed class PitchMateDbContextFactory : IDesignTimeDbContextFactory<PitchMateDbContext>
{
    private const string DesignTimeConnectionString =
        "Host=localhost;Database=pitchmate_designtime;Username=postgres;Password=postgres";

    /// <inheritdoc />
    public PitchMateDbContext CreateDbContext(string[] args)
    {
        var options = new DbContextOptionsBuilder<PitchMateDbContext>()
            .UseNpgsql(DesignTimeConnectionString)
            .UseSnakeCaseNamingConvention()
            .Options;

        return new PitchMateDbContext(options, TimeProvider.System, new SystemCurrentUserAccessor());
    }
}
