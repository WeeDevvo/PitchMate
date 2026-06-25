using Microsoft.EntityFrameworkCore;
using PitchMate.Application.Common;
using PitchMate.Infrastructure.Persistence;

namespace PitchMate.Infrastructure.Tests.Persistence;

/// <summary>
/// A test-only <see cref="PitchMateDbContext"/> that additionally maps the persistence
/// harness's test entities (<see cref="PersistenceTestEntity"/> and
/// <see cref="PersistenceTestRelatedEntity"/>). The persistence-foundation production context
/// deliberately contains no concrete entities, so the harness needs at least one
/// <see cref="BaseEntity"/>-derived type to exercise the shared save-time conventions against
/// real PostgreSQL.
/// <para>
/// The test entity configurations are applied <em>before</em> delegating to the base
/// <c>OnModelCreating</c>, so that the base context's shared <c>BaseEntity</c> conventions
/// (uuid primary key, <c>xmin</c> concurrency token, soft-delete query filter, UTC audit
/// columns) are then layered over the test entities exactly as they would be over real ones.
/// </para>
/// </summary>
public sealed class PersistenceTestDbContext : PitchMateDbContext
{
    /// <summary>The harness's representative PII-bearing test entity set.</summary>
    public DbSet<PersistenceTestEntity> TestEntities => Set<PersistenceTestEntity>();

    /// <summary>The navigation-target test entity set.</summary>
    public DbSet<PersistenceTestRelatedEntity> RelatedEntities => Set<PersistenceTestRelatedEntity>();

    /// <summary>
    /// Initialises the test context with the same options/clock/actor dependencies as the
    /// production context.
    /// </summary>
    /// <param name="options">The context options (provider, connection, naming convention).</param>
    /// <param name="clock">The (typically controllable) time abstraction supplying the current UTC instant.</param>
    /// <param name="currentUser">The (typically controllable) accessor supplying the current actor.</param>
    public PersistenceTestDbContext(
        DbContextOptions<PitchMateDbContext> options,
        TimeProvider clock,
        ICurrentUserAccessor currentUser)
        : base(options, clock, currentUser)
    {
    }

    /// <inheritdoc />
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        // Register the test-only entity configurations before the base context discovers the
        // Infrastructure configurations and applies the shared BaseEntity conventions, so the
        // test entities are present in the model when those conventions are layered on.
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(PersistenceTestDbContext).Assembly);

        base.OnModelCreating(modelBuilder);
    }
}
