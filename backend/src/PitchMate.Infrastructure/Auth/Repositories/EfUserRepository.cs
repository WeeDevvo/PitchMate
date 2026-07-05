using Microsoft.EntityFrameworkCore;
using PitchMate.Application.Auth.Abstractions;
using PitchMate.Domain.Auth;
using PitchMate.Infrastructure.Persistence;

namespace PitchMate.Infrastructure.Auth.Repositories;

/// <summary>
/// EF Core implementation of <see cref="IUserRepository"/> over the shared
/// <see cref="PitchMateDbContext"/>. Loads a user by primary key and stages a newly
/// created user; mutations are flushed by the unit of work as part of the surrounding
/// transaction, so no explicit update method is exposed.
/// <para>Validates: Requirements 1.4, 1.11, 12.3.</para>
/// </summary>
internal sealed class EfUserRepository(PitchMateDbContext db) : IUserRepository
{
    /// <inheritdoc />
    public Task<User?> GetByIdAsync(Guid id, CancellationToken ct)
        // The global soft-delete query filter (e => !e.IsDeleted) excludes deleted rows.
        // Identities (and their credentials) are loaded so callers can inspect or revoke
        // a user's sign-in methods.
        => db.Set<User>()
            .Include(u => u.Identities)
                .ThenInclude(i => i.Credential)
            .FirstOrDefaultAsync(u => u.Id == id, ct);

    /// <inheritdoc />
    public async Task AddAsync(User user, CancellationToken ct)
        => await db.Set<User>().AddAsync(user, ct);
}
