using Microsoft.EntityFrameworkCore;
using PitchMate.Application.Common.Persistence;
using PitchMate.Domain.Common;

namespace PitchMate.Infrastructure.Persistence;

/// <summary>
/// EF Core implementation of <see cref="IRepository{T}"/> over the shared
/// <see cref="PitchMateDbContext"/>. Reads honour the global soft-delete query filter,
/// writes are staged on the change tracker and committed by the unit of work, and
/// removal is expressed as an EF <c>Deleted</c> state which the context's save pipeline
/// reinterprets as a soft-delete for <see cref="ISoftDeletable"/> types.
/// <para>Validates: Requirements 5.2, 5.4, 5.5, 3.2, 3.4, 3.8, 10.5.</para>
/// </summary>
/// <typeparam name="T">The entity type, deriving from <see cref="BaseEntity"/>.</typeparam>
internal sealed class EfRepository<T>(PitchMateDbContext db) : IRepository<T>
    where T : BaseEntity
{
    /// <inheritdoc />
    public async Task AddAsync(T entity, CancellationToken cancellationToken)
        => await db.Set<T>().AddAsync(entity, cancellationToken);

    /// <inheritdoc />
    public Task<T?> GetByIdAsync(Guid id, CancellationToken cancellationToken)
        // The global soft-delete query filter (e => !e.IsDeleted) excludes deleted rows.
        => db.Set<T>().FirstOrDefaultAsync(e => e.Id == id, cancellationToken);

    /// <inheritdoc />
    public async Task<IReadOnlyList<T>> ListAsync(CancellationToken cancellationToken)
        => await db.Set<T>().ToListAsync(cancellationToken);

    /// <inheritdoc />
    public async Task<IReadOnlyList<T>> ListChronologicalAsync(
        bool includeDeleted,
        CancellationToken cancellationToken)
    {
        IQueryable<T> query = db.Set<T>();

        if (includeDeleted)
        {
            // Bypass the global soft-delete filter so deleted rows are included (Req 3.4, 10.5).
            query = query.IgnoreQueryFilters();
        }

        // Ordering is expressed in the query so PostgreSQL evaluates it: CreatedAt ascending,
        // then Id ascending (uuid byte order == v7 creation order), matching ChronologicalOrder
        // (Req 10.5).
        return await query
            .OrderBy(e => e.CreatedAt)
            .ThenBy(e => e.Id)
            .ToListAsync(cancellationToken);
    }

    /// <inheritdoc />
    public void Remove(T entity)
        // Sets EF state to Deleted; the save pipeline reinterprets this as a soft-delete
        // for ISoftDeletable types and a hard-delete otherwise (Req 3.2).
        => db.Set<T>().Remove(entity);

    /// <inheritdoc />
    public void Restore(T entity)
    {
        // Clear soft-delete state via the Domain mediator and mark the entity modified so the
        // cleared IsDeleted/DeletedAt are persisted on save (Req 3.8).
        entity.Restore();
        db.Set<T>().Update(entity);
    }
}
