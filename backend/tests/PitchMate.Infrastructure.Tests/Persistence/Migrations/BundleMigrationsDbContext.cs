using Microsoft.EntityFrameworkCore;

namespace PitchMate.Infrastructure.Tests.Persistence.Migrations;

/// <summary>
/// A test-only <see cref="DbContext"/> carrying two ordered, raw-SQL EF Core migrations
/// (<see cref="CreateBundleOne"/> then <see cref="CreateBundleTwo"/>). It exists so the migration
/// integration tests can exercise the EF Core migrator — the same engine an
/// <c>efbundle</c> deploy-step runner wraps — over a real multi-migration sequence: ordered apply
/// with success reporting (Requirement 12.4) and the no-pending no-op (Requirement 12.6).
/// <para>
/// The production <see cref="PitchMate.Infrastructure.Persistence.PitchMateDbContext"/> defines no
/// concrete entities yet, so its single initial migration is empty; this context provides a
/// representative ordered migration set to validate the runner contract that real feature
/// migrations will rely on.
/// </para>
/// </summary>
public sealed class BundleMigrationsDbContext : DbContext
{
    /// <summary>Initialises the context with options targeting a throwaway test database.</summary>
    /// <param name="options">The provider/connection options.</param>
    public BundleMigrationsDbContext(DbContextOptions<BundleMigrationsDbContext> options)
        : base(options)
    {
    }
}
