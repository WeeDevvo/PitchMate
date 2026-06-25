using Microsoft.EntityFrameworkCore;

namespace PitchMate.Infrastructure.Tests.Persistence.Migrations;

/// <summary>
/// A test-only <see cref="DbContext"/> whose migration set is a successful first migration
/// (<see cref="CreateFailingOne"/>) followed by a second migration (<see cref="CreateFailingTwo"/>)
/// that deliberately fails partway through its <c>Up</c>. It lets the migration integration tests
/// validate the failure contract the deploy-step runner relies on:
/// <list type="bullet">
/// <item>a migration that fails before completion leaves no partial schema and surfaces an error
/// (Requirement 11.6);</item>
/// <item>the runner stops before later migrations, leaves already-applied migrations intact, rolls
/// back the failed migration, and surfaces a failure identifying it (Requirement 12.5).</item>
/// </list>
/// PostgreSQL's transactional DDL means EF Core applies each migration inside a transaction, so the
/// failed migration's first statement is rolled back with the statement that failed.
/// </summary>
public sealed class FailingMigrationsDbContext : DbContext
{
    /// <summary>Initialises the context with options targeting a throwaway test database.</summary>
    /// <param name="options">The provider/connection options.</param>
    public FailingMigrationsDbContext(DbContextOptions<FailingMigrationsDbContext> options)
        : base(options)
    {
    }
}
