using PitchMate.Application.Common.Persistence;
using PitchMate.Domain.Common;

namespace PitchMate.Application.Tests.Common.Persistence;

/// <summary>
/// An in-memory fake <see cref="IRepository{T}"/> whose async operations honour the
/// supplied <see cref="CancellationToken"/> via
/// <see cref="CancellationToken.ThrowIfCancellationRequested"/>, so a pre-cancelled
/// token surfaces an <see cref="OperationCanceledException"/>. Named distinctly to
/// avoid colliding with test doubles defined by sibling tasks in this project.
/// </summary>
/// <typeparam name="T">The entity type, deriving from <see cref="BaseEntity"/>.</typeparam>
internal sealed class SignatureFakeRepository<T> : IRepository<T>
    where T : BaseEntity
{
    private readonly Dictionary<Guid, T> _store = [];

    public Task AddAsync(T entity, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        _store[entity.Id] = entity;
        return Task.CompletedTask;
    }

    public Task<T?> GetByIdAsync(Guid id, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(_store.TryGetValue(id, out var entity) ? entity : null);
    }

    public Task<IReadOnlyList<T>> ListAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<IReadOnlyList<T>>(_store.Values.ToList());
    }

    public Task<IReadOnlyList<T>> ListChronologicalAsync(bool includeDeleted, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        IEnumerable<T> source = includeDeleted ? _store.Values : _store.Values.Where(e => !e.IsDeleted);
        var ordered = source.OrderBy(e => e, ChronologicalOrder.Instance).ToList();
        return Task.FromResult<IReadOnlyList<T>>(ordered);
    }

    public void Remove(T entity) => _store.Remove(entity.Id);

    public void Restore(T entity) => _store[entity.Id] = entity;
}
