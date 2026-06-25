using Microsoft.EntityFrameworkCore;
using Npgsql;
using PitchMate.Application.Common.Persistence;

namespace PitchMate.Infrastructure.Persistence;

/// <summary>
/// EF Core implementation of <see cref="IUnitOfWork"/> over the shared
/// <see cref="PitchMateDbContext"/>. Commits all changes tracked since the previous
/// commit as a single atomic transaction (EF Core wraps the multi-statement save in a
/// transaction and rolls back fully on failure, so no partial change is persisted),
/// and translates provider-specific failures into the Application-layer persistence
/// error types so use cases never see EF Core / Npgsql types.
/// <para>Validates: Requirements 6.2, 6.3, 6.4, 6.6, 7.5, 8.7, 8.8, 9.2, 9.3.</para>
/// </summary>
internal sealed class UnitOfWork(PitchMateDbContext db) : IUnitOfWork
{
    /// <inheritdoc />
    public async Task<int> SaveChangesAsync(CancellationToken cancellationToken)
    {
        try
        {
            // Returns the count of state-changed entities (0 when nothing changed).
            return await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException ex)
        {
            // Must precede the general DbUpdateException catch — it derives from it.
            throw new ConcurrencyConflictException(ex);
        }
        catch (DbUpdateException ex) when (IsUniqueViolation(ex))
        {
            throw new DuplicateKeyException(ex);
        }
        catch (DbUpdateException ex)
        {
            throw new SaveFailedException(ex);
        }

        // OperationCanceledException is intentionally NOT caught here: cancellation
        // propagates to the caller as the standard exception type (Requirement 6.6).
    }

    /// <summary>
    /// Determines whether a <see cref="DbUpdateException"/> was caused by a PostgreSQL
    /// unique-constraint violation (SQLSTATE <c>23505</c>), i.e. an attempt to insert a
    /// row whose primary key already exists.
    /// </summary>
    private static bool IsUniqueViolation(DbUpdateException ex) =>
        ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation };
}
