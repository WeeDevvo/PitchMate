using PitchMate.Domain.Common;

namespace PitchMate.Application.Common.Persistence;

/// <summary>
/// A generic, Domain-only repository abstraction for adding, retrieving, and querying
/// a single <see cref="BaseEntity"/>-derived type. Implemented in Infrastructure over
/// the EF Core <c>PitchMateDbContext</c>, this interface keeps Application use cases
/// free of EF Core / Npgsql / ASP.NET Core types.
/// <para>
/// Every input/output-bound operation is asynchronous and accepts a
/// <see cref="CancellationToken"/>; a signalled token surfaces cancellation to the
/// caller. <see cref="Remove"/> and <see cref="Restore"/> mutate tracked state only
/// (not I/O-bound) and are therefore synchronous — the write itself happens on
/// <see cref="IUnitOfWork.SaveChangesAsync"/>.
/// </para>
/// <para>Validates: Requirements 5.1, 5.2, 5.3, 5.7.</para>
/// </summary>
/// <typeparam name="T">The entity type, deriving from <see cref="BaseEntity"/>.</typeparam>
public interface IRepository<T>
    where T : BaseEntity
{
    /// <summary>
    /// Stages an insert of <paramref name="entity"/>. The row is written when
    /// <see cref="IUnitOfWork.SaveChangesAsync"/> commits. Validates: Requirement 5.2.
    /// </summary>
    /// <param name="entity">The entity to add.</param>
    /// <param name="cancellationToken">A token that surfaces cancellation to the caller.</param>
    Task AddAsync(T entity, CancellationToken cancellationToken);

    /// <summary>
    /// Retrieves the single non-deleted entity whose identity equals <paramref name="id"/>.
    /// Returns <see langword="null"/> when no non-deleted entity matches, without raising
    /// an error. Validates: Requirements 5.2, 5.4.
    /// </summary>
    /// <param name="id">The identity to look up.</param>
    /// <param name="cancellationToken">A token that surfaces cancellation to the caller.</param>
    /// <returns>The matching entity, or <see langword="null"/> when none matches.</returns>
    Task<T?> GetByIdAsync(Guid id, CancellationToken cancellationToken);

    /// <summary>
    /// Retrieves all non-deleted entities of the parameterised type. Returns an empty
    /// list (never <see langword="null"/>) when none match. Validates: Requirements 5.2, 5.5.
    /// </summary>
    /// <param name="cancellationToken">A token that surfaces cancellation to the caller.</param>
    /// <returns>The matching entities, or an empty list when none exist.</returns>
    Task<IReadOnlyList<T>> ListAsync(CancellationToken cancellationToken);

    /// <summary>
    /// Retrieves entities in the stable chronological replay order (CreatedAt ascending,
    /// then Id ascending by UUID v7 byte sequence), evaluated within the database.
    /// Soft-deleted rows are included when <paramref name="includeDeleted"/> is
    /// <see langword="true"/>. Validates: Requirement 10.5.
    /// </summary>
    /// <param name="includeDeleted">Whether soft-deleted rows are included.</param>
    /// <param name="cancellationToken">A token that surfaces cancellation to the caller.</param>
    /// <returns>The matching entities in chronological order, or an empty list when none exist.</returns>
    Task<IReadOnlyList<T>> ListChronologicalAsync(bool includeDeleted, CancellationToken cancellationToken);

    /// <summary>
    /// Marks <paramref name="entity"/> for deletion. For a soft-deletable type the save
    /// pipeline reinterprets this as a soft-delete; otherwise the row is hard-deleted.
    /// Synchronous because it only mutates tracked state.
    /// </summary>
    /// <param name="entity">The entity to remove.</param>
    void Remove(T entity);

    /// <summary>
    /// Restores a soft-deleted <paramref name="entity"/>, clearing its deletion state.
    /// Synchronous because it only mutates tracked state.
    /// </summary>
    /// <param name="entity">The entity to restore.</param>
    void Restore(T entity);
}
