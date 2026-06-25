using PitchMate.Application.Common.Persistence;
using PitchMate.Domain.Common;

namespace PitchMate.Application.Tests.Fakes;

/// <summary>
/// A hand-written, in-memory test double for <see cref="IRepository{T}"/> — a real fake
/// backed by a dictionary, not a mocking-framework stub and not a database. It faithfully
/// models the Application-layer repository contract so pure (no-database) properties can be
/// exercised against it: identity lookup, non-deleted listing, chronological ordering, and
/// soft-delete / restore.
/// <para>
/// Entities are keyed by their <see cref="BaseEntity.Id"/>; <see cref="Remove"/> / <see cref="Restore"/>
/// flip a per-id soft-delete marker (the entity's own soft-delete state is mediated internally
/// in the Domain layer and is not mutated here). Every input/output-bound operation observes its
/// <see cref="CancellationToken"/> so a signalled token surfaces cancellation to the caller.
/// </para>
/// </summary>
/// <typeparam name="T">The entity type, deriving from <see cref="BaseEntity"/>.</typeparam>
public sealed class InMemoryRepository<T> : IRepository<T>
    where T : BaseEntity
{
    private readonly Dictionary<Guid, T> _store = new();
    private readonly HashSet<Guid> _deleted = new();

    /// <inheritdoc />
    public Task AddAsync(T entity, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        ArgumentNullException.ThrowIfNull(entity);
        _store[entity.Id] = entity;
        _deleted.Remove(entity.Id);
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task<T?> GetByIdAsync(Guid id, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var found = _store.TryGetValue(id, out var entity) && !_deleted.Contains(id)
            ? entity
            : null;
        return Task.FromResult(found);
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<T>> ListAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        IReadOnlyList<T> result = _store.Values
            .Where(e => !_deleted.Contains(e.Id))
            .ToList();
        return Task.FromResult(result);
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<T>> ListChronologicalAsync(bool includeDeleted, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        IReadOnlyList<T> result = _store.Values
            .Where(e => includeDeleted || !_deleted.Contains(e.Id))
            .OrderBy(e => (BaseEntity)e, ChronologicalOrder.Instance)
            .ToList();
        return Task.FromResult(result);
    }

    /// <inheritdoc />
    public void Remove(T entity)
    {
        ArgumentNullException.ThrowIfNull(entity);
        _deleted.Add(entity.Id);
    }

    /// <inheritdoc />
    public void Restore(T entity)
    {
        ArgumentNullException.ThrowIfNull(entity);
        _deleted.Remove(entity.Id);
    }
}
