using PitchMate.Domain.Auth;

namespace PitchMate.Application.Auth.Abstractions;

/// <summary>
/// Persistence gateway for <see cref="User"/> aggregates: load a user by primary key and
/// add a newly created user. Mutations are flushed via the unit of work, so this contract
/// exposes no explicit update method — tracked entities are saved as part of the
/// surrounding transaction.
/// </summary>
public interface IUserRepository
{
    /// <summary>
    /// Loads the <see cref="User"/> with the given <paramref name="id"/>, or
    /// <see langword="null"/> when no such user exists.
    /// </summary>
    /// <param name="id">The user's identifier.</param>
    /// <param name="ct">A token to cancel the operation.</param>
    Task<User?> GetByIdAsync(Guid id, CancellationToken ct);

    /// <summary>
    /// Stages a newly created <paramref name="user"/> for insertion; persisted when the
    /// unit of work is committed.
    /// </summary>
    /// <param name="user">The user to add.</param>
    /// <param name="ct">A token to cancel the operation.</param>
    Task AddAsync(User user, CancellationToken ct);
}
