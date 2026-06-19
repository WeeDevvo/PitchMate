using Microsoft.EntityFrameworkCore;

namespace PitchMate.Infrastructure.Persistence;

/// <summary>
/// EF Core database context for PitchMate.
/// Entity sets and configurations are added by feature specs (e.g. squads, matches, ratings).
/// </summary>
public class PitchMateDbContext : DbContext
{
    public PitchMateDbContext(DbContextOptions<PitchMateDbContext> options)
        : base(options)
    {
    }
}
