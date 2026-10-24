namespace PitchMate.Application.Common.Persistence;

/// <summary>
/// A Domain-only Unit-of-Work abstraction that commits all changes tracked since the
/// previous commit as a single atomic transaction. Implemented in Infrastructure over
/// the EF Core <c>PitchMateDbContext</c>, keeping Application use cases free of EF Core
/// / Npgsql / ASP.NET Core types.
/// <para>Validates: Requirements 6.1, 6.5.</para>
/// </summary>
public interface IUnitOfWork
{
    /// <summary>
    /// Commits all tracked changes atomically and returns the count of state-changed
    /// entities (zero when nothing changed). On any save failure no change is persisted;
    /// the operation surfaces a save-failure, concurrency-conflict, or duplicate-key
    /// error, and propagates cancellation when the token is signalled.
    /// <para>Validates: Requirement 6.1.</para>
    /// </summary>
    /// <param name="cancellationToken">A token that aborts the save and surfaces cancellation to the caller.</param>
    /// <returns>The count of state-changed entities persisted by this save.</returns>
    Task<int> SaveChangesAsync(CancellationToken cancellationToken);

    /// <summary>
    /// Runs <paramref name="work"/> inside one database transaction, so several
    /// <see cref="SaveChangesAsync"/> calls made by it commit together or not at all. Use it only
    /// when one save cannot express the change, e.g. when a per-statement constraint needs one row
    /// written before another. The transaction commits when <paramref name="work"/> completes and
    /// rolls back if it throws. When a transaction is already open, <paramref name="work"/> joins it.
    /// <para>
    /// The default runs <paramref name="work"/> directly, which suits in-memory doubles with no
    /// transaction to open; the EF Core implementation overrides it with a real transaction.
    /// </para>
    /// </summary>
    /// <param name="work">The saves to run atomically; receives <paramref name="cancellationToken"/>.</param>
    /// <param name="cancellationToken">A token that aborts the work and the transaction.</param>
    Task ExecuteInTransactionAsync(Func<CancellationToken, Task> work, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(work);
        return work(cancellationToken);
    }
}
