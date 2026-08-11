using System.Reflection;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using PitchMate.Application.Common;
using PitchMate.Application.Common.Persistence;
using PitchMate.Domain.Common;
using PitchMate.Domain.LiveTracking;

namespace PitchMate.Infrastructure.Persistence;

/// <summary>
/// EF Core database context for PitchMate. Applies the cross-cutting persistence
/// conventions every <see cref="BaseEntity"/>-derived entity inherits: a <c>uuid</c>
/// primary key with application-supplied identity, an <c>xmin</c> optimistic-concurrency
/// token, a global soft-delete query filter, and UTC <c>timestamp with time zone</c>
/// mapping for point-in-time values.
/// <para>
/// Concrete entity sets and their per-entity <see cref="IEntityTypeConfiguration{TEntity}"/>
/// implementations are contributed by later feature specs and discovered automatically
/// from this assembly; no per-entity configuration is inlined here.
/// </para>
/// </summary>
public class PitchMateDbContext : DbContext
{
    private static readonly MethodInfo ApplyBaseEntityConfigurationMethod =
        typeof(PitchMateDbContext).GetMethod(
            nameof(ApplyBaseEntityConfiguration),
            BindingFlags.NonPublic | BindingFlags.Static)!;

    private readonly TimeProvider _clock;
    private readonly ICurrentUserAccessor _currentUser;

    // Entities explicitly marked for a genuine, permanent delete (the purge and erasure paths),
    // which must bypass the soft-delete reinterpretation the save pipeline otherwise applies to
    // every BaseEntity (Req 17.5, 18.2). Reference identity is used so a marked instance is matched
    // regardless of any value-equality semantics. Cleared after each successful save.
    private readonly HashSet<BaseEntity> _hardDeletes = new(ReferenceEqualityComparer.Instance);

    /// <summary>
    /// Initialises the context with its options, an injected clock used to stamp audit
    /// timestamps, and the accessor that supplies the acting user for audit metadata.
    /// </summary>
    /// <param name="options">The context options (provider, connection, naming convention).</param>
    /// <param name="clock">The time abstraction supplying the current UTC instant.</param>
    /// <param name="currentUser">The accessor supplying the current actor, or none for system operations.</param>
    public PitchMateDbContext(
        DbContextOptions<PitchMateDbContext> options,
        TimeProvider clock,
        ICurrentUserAccessor currentUser)
        : base(options)
    {
        _clock = clock;
        _currentUser = currentUser;
    }

    /// <summary>
    /// The append-only live-tracking event log, mapped table-per-hierarchy on <c>EventKind</c>. Keyed
    /// on the client-generated GUID v7 <c>Event_Id</c>, it is never updated or deleted once an event is
    /// accepted (Requirement 1.3, 1.6).
    /// </summary>
    public DbSet<MatchEvent> MatchEvents => Set<MatchEvent>();

    /// <inheritdoc />
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        // Discover per-entity configurations colocated with their entities rather than
        // inlining configuration here (Req 8.1).
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(PitchMateDbContext).Assembly);

        // Apply the shared BaseEntity mapping to every discovered derived entity type.
        ApplyBaseEntityConventions(modelBuilder);
    }

    /// <inheritdoc />
    protected override void ConfigureConventions(ModelConfigurationBuilder configurationBuilder)
    {
        base.ConfigureConventions(configurationBuilder);

        // Store every point-in-time value as UTC timestamptz (Req 8.4, 8.5).
        configurationBuilder.Properties<DateTimeOffset>()
            .HaveColumnType("timestamp with time zone");
        configurationBuilder.Properties<DateTime>()
            .HaveColumnType("timestamp with time zone");
    }

    /// <summary>
    /// Commits tracked changes. Before delegating to the base implementation this
    /// rejects any entity carrying an absent/all-zero identifier (Req 9.4) and then
    /// stamps audit metadata and reinterprets deletions as soft-deletes (Req 2, 3),
    /// so the save-time conventions apply uniformly regardless of the calling use case.
    /// </summary>
    /// <param name="cancellationToken">A token to cancel the asynchronous save.</param>
    /// <returns>The count of state-changed entities persisted.</returns>
    public override async Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        // Reject invalid identifiers before any I/O (Req 9.4).
        ApplyIdValidation();

        // Stamp audit fields and convert deletions to soft-deletes (Req 2, 3), except for entities
        // explicitly marked for a permanent delete, which keep their EF Deleted state (Req 17.5, 18.2).
        ApplyAuditAndSoftDelete(this, _clock.GetUtcNow(), _currentUser.CurrentUserId);

        // A soft-deleted owner keeps its row, so its owned dependents (which EF cascaded to Deleted)
        // must be kept too rather than physically removed.
        RetainOwnedDependentsOfSoftDeletedOwners(this);

        var result = await base.SaveChangesAsync(cancellationToken);

        // The permanent-delete markers only apply to the batch just committed.
        _hardDeletes.Clear();
        return result;
    }

    /// <summary>
    /// Marks <paramref name="entity"/> for a genuine, permanent delete so the save pipeline leaves
    /// its EF <see cref="EntityState.Deleted"/> state intact rather than reinterpreting it as a
    /// soft-delete (Req 17.5, 18.2). The caller is responsible for also placing the entity in the
    /// <see cref="EntityState.Deleted"/> state (via <c>Set&lt;T&gt;().Remove</c>); the delete is
    /// committed on the next <see cref="SaveChangesAsync"/>. Used by the squad purge and erasure
    /// repositories.
    /// </summary>
    /// <param name="entity">The entity to remove permanently on the next save.</param>
    internal void MarkForHardDelete(BaseEntity entity) => _hardDeletes.Add(entity);

    /// <summary>
    /// Rejects any tracked entity that is being inserted, updated, or deleted while its
    /// <see cref="BaseEntity.Id"/> is the all-zero GUID, before any database I/O (Req 9.4).
    /// </summary>
    /// <exception cref="InvalidEntityIdException">An entity has an absent/all-zero identifier.</exception>
    private void ApplyIdValidation()
    {
        foreach (var entry in ChangeTracker.Entries<BaseEntity>())
        {
            if (entry.State is EntityState.Added or EntityState.Modified or EntityState.Deleted
                && entry.Entity.Id == Guid.Empty)
            {
                throw new InvalidEntityIdException();
            }
        }
    }

    /// <summary>
    /// Applies the save-time audit and soft-delete conventions to every tracked
    /// <see cref="BaseEntity"/>:
    /// <list type="bullet">
    /// <item>Added entities receive matching created/updated timestamps and actors,
    /// overriding any caller-supplied audit values (Req 2.2, 2.4, 2.8).</item>
    /// <item>Modified entities receive a fresh updated timestamp and actor while their
    /// creation provenance is left intact (Req 2.3, 2.5).</item>
    /// <item>Deletions of soft-deletable entities are reinterpreted as soft-deletes
    /// (Req 3.2), idempotently preserving an existing soft-delete (Req 3.7).</item>
    /// </list>
    /// </summary>
    /// <param name="now">The current UTC instant supplied by the clock.</param>
    /// <param name="actor">The current actor, or <see langword="null"/> for system operations (Req 2.6).</param>
    private static void ApplyAuditAndSoftDelete(PitchMateDbContext context, DateTimeOffset now, string? actor)
    {
        foreach (var entry in context.ChangeTracker.Entries<BaseEntity>())
        {
            switch (entry.State)
            {
                case EntityState.Added:
                    entry.Entity.CreatedAt = now;
                    entry.Entity.UpdatedAt = now;
                    entry.Entity.CreatedBy = actor;
                    entry.Entity.UpdatedBy = actor;
                    break;

                case EntityState.Modified:
                    StampModification(entry, now, actor);
                    break;

                case EntityState.Deleted:
                    // An entity explicitly marked for permanent removal keeps its EF Deleted state
                    // so it is genuinely deleted (Req 17.5, 18.2); everything else soft-deletes.
                    if (!context._hardDeletes.Contains(entry.Entity))
                    {
                        ApplyDeletion(entry, now, actor);
                    }

                    break;
            }
        }
    }

    /// <summary>
    /// Reinterprets EF Core's cascade of an <em>owned</em> dependent to <see cref="EntityState.Deleted"/>
    /// when its owner is only being soft-deleted. Because a soft-deleted owner keeps its row (its
    /// delete was rewritten to a soft-delete by <see cref="ApplyAuditAndSoftDelete"/>), its owned rows —
    /// which are not <see cref="BaseEntity"/> instances and so are never soft-deletable themselves
    /// (e.g. a squad's feature flags) — must be retained alongside it; otherwise a later restore would
    /// find them gone. Each such cascaded-delete entry is reverted to <see cref="EntityState.Unchanged"/>.
    /// A genuinely hard-deleted owner (the purge/erasure path) is excluded, so its owned rows are still
    /// removed with it (Req 17.4, 17.5).
    /// </summary>
    private static void RetainOwnedDependentsOfSoftDeletedOwners(PitchMateDbContext context)
    {
        foreach (var entry in context.ChangeTracker.Entries().ToList())
        {
            if (entry.State != EntityState.Deleted || !entry.Metadata.IsOwned())
            {
                continue;
            }

            var owner = FindOwnerEntity(context, entry);

            // Keep the owned row only when its owner is being soft-deleted (row retained), not
            // hard-deleted (row genuinely removed, so its owned rows go with it).
            if (owner is not null && owner.IsDeleted && !context._hardDeletes.Contains(owner))
            {
                entry.State = EntityState.Unchanged;
            }
        }
    }

    /// <summary>
    /// Resolves the owning <see cref="BaseEntity"/> of an owned dependent entry by matching the
    /// dependent's ownership foreign-key values against the tracked principal's primary key.
    /// </summary>
    private static BaseEntity? FindOwnerEntity(PitchMateDbContext context, EntityEntry ownedEntry)
    {
        var ownership = ownedEntry.Metadata.FindOwnership();
        if (ownership is null)
        {
            return null;
        }

        var principalClrType = ownership.PrincipalEntityType.ClrType;
        var foreignKeyValues = ownership.Properties
            .Select(property => ownedEntry.Property(property.Name).CurrentValue)
            .ToArray();
        var principalKeyNames = ownership.PrincipalKey.Properties
            .Select(property => property.Name)
            .ToArray();

        foreach (var candidate in context.ChangeTracker.Entries<BaseEntity>())
        {
            if (!principalClrType.IsInstanceOfType(candidate.Entity))
            {
                continue;
            }

            var matches = true;
            for (var i = 0; i < principalKeyNames.Length; i++)
            {
                if (!Equals(candidate.Property(principalKeyNames[i]).CurrentValue, foreignKeyValues[i]))
                {
                    matches = false;
                    break;
                }
            }

            if (matches)
            {
                return candidate.Entity;
            }
        }

        return null;
    }

    /// <summary>
    /// Stamps a modified entity's <see cref="BaseEntity.UpdatedAt"/> and
    /// <see cref="BaseEntity.UpdatedBy"/> while marking its creation provenance as
    /// unchanged, so a first-persist <c>CreatedAt</c>/<c>CreatedBy</c> survives later
    /// updates (Req 2.3, 2.5).
    /// </summary>
    private static void StampModification(EntityEntry<BaseEntity> entry, DateTimeOffset now, string? actor)
    {
        entry.Entity.UpdatedAt = now;
        entry.Entity.UpdatedBy = actor;

        // Never let an update overwrite the recorded creation provenance.
        entry.Property(e => e.CreatedAt).IsModified = false;
        entry.Property(e => e.CreatedBy).IsModified = false;
    }

    /// <summary>
    /// Reinterprets an EF <see cref="EntityState.Deleted"/> on a soft-deletable entity as
    /// a soft-delete: an active row is flagged deleted and stamped (Req 3.2), while a row
    /// that is already soft-deleted is left untouched so its grace-period start is
    /// preserved (Req 3.7). Because every <see cref="BaseEntity"/> is soft-deletable, this
    /// retains the row; non-soft-deletable entities (outside this set) keep EF's hard
    /// delete (Req 3.5).
    /// </summary>
    private static void ApplyDeletion(EntityEntry<BaseEntity> entry, DateTimeOffset now, string? actor)
    {
        if (entry.Entity.IsDeleted)
        {
            // Already soft-deleted: keep the row and its original DeletedAt unchanged (Req 3.7).
            entry.State = EntityState.Unchanged;
            return;
        }

        // Convert the hard delete into an update that flags the row as soft-deleted (Req 3.2).
        entry.State = EntityState.Modified;

        // IsDeleted/DeletedAt have private setters; write through the tracked property values.
        entry.Property(nameof(BaseEntity.IsDeleted)).CurrentValue = true;
        entry.Property(nameof(BaseEntity.DeletedAt)).CurrentValue = now;

        // A soft-delete is a modification, so it carries update audit metadata.
        StampModification(entry, now, actor);
    }

    /// <summary>
    /// Iterates the model and applies the shared base-entity mapping to every entity type
    /// whose CLR type derives from <see cref="BaseEntity"/>, dispatching to a strongly-typed
    /// generic helper so the soft-delete query filter is built against the concrete type.
    /// </summary>
    private static void ApplyBaseEntityConventions(ModelBuilder modelBuilder)
    {
        foreach (var entityType in modelBuilder.Model.GetEntityTypes())
        {
            if (!typeof(BaseEntity).IsAssignableFrom(entityType.ClrType))
            {
                continue;
            }

            // For an inheritance hierarchy (e.g. the table-per-hierarchy MatchEvent log) the key,
            // concurrency token, and soft-delete query filter belong on the root type only; the
            // derived types share the root's table and mapping, and EF rejects configuring a key or
            // query filter on a non-root type. Skip anything that is not the root of its hierarchy.
            if (entityType.BaseType is not null)
            {
                continue;
            }

            ApplyBaseEntityConfigurationMethod
                .MakeGenericMethod(entityType.ClrType)
                .Invoke(null, [modelBuilder]);
        }
    }

    /// <summary>
    /// Configures the shared mapping for a single <see cref="BaseEntity"/>-derived type:
    /// the <c>Id</c> primary key as a <c>uuid</c> with application-supplied values
    /// (<see cref="RelationalPropertyBuilderExtensions"/> / <c>ValueGeneratedNever</c>),
    /// an <c>xmin</c> optimistic-concurrency token, and the global soft-delete query filter.
    /// </summary>
    /// <typeparam name="T">The concrete <see cref="BaseEntity"/>-derived entity type.</typeparam>
    /// <param name="modelBuilder">The model builder being configured.</param>
    private static void ApplyBaseEntityConfiguration<T>(ModelBuilder modelBuilder)
        where T : BaseEntity
    {
        var entity = modelBuilder.Entity<T>();

        // Id -> uuid primary key, value supplied by the application (Req 1.4, 1.5, 9.1, 9.5).
        entity.HasKey(e => e.Id);
        entity.Property(e => e.Id)
            .HasColumnType("uuid")
            .ValueGeneratedNever();

        // xmin system column as the optimistic-concurrency token (Req 8.6).
        // The Npgsql provider maps a uint row-version property to PostgreSQL's implicit
        // xmin system column, which auto-increments on every update. (This is the v9+
        // replacement for the removed UseXminAsConcurrencyToken() extension method.) The
        // token is held as a shadow property so BaseEntity stays free of persistence concerns.
        entity.Property<uint>("Version")
            .IsRowVersion();

        // Global soft-delete query filter excludes deleted rows by default (Req 3.3).
        entity.HasQueryFilter(e => !e.IsDeleted);
    }
}
