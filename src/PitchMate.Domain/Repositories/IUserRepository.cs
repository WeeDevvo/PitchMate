using PitchMate.Domain.Entities;
using PitchMate.Domain.ValueObjects;

namespace PitchMate.Domain.Repositories;

/// <summary>
/// Repository interface for User aggregate operations.
/// Defines data persistence contracts for the domain layer without framework dependencies.
/// </summary>
public interface IUserRepository
{
    /// <summary>
    /// Retrieves a user by their unique identifier.
    /// </summary>
    /// <param name="id">The user's unique identifier.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>The user if found, otherwise null.</returns>
    Task<User?> GetByIdAsync(UserId id, CancellationToken ct = default);

    /// <summary>
    /// Retrieves a user by their email address.
    /// </summary>
    /// <param name="email">The user's email address.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>The user if found, otherwise null.</returns>
    Task<User?> GetByEmailAsync(Email email, CancellationToken ct = default);

    /// <summary>
    /// Retrieves a user by their Google OAuth identifier.
    /// </summary>
    /// <param name="googleId">The user's Google ID.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>The user if found, otherwise null.</returns>
    Task<User?> GetByGoogleIdAsync(string googleId, CancellationToken ct = default);

    /// <summary>
    /// Adds a new user to the repository.
    /// </summary>
    /// <param name="user">The user to add.</param>
    /// <param name="ct">Cancellation token.</param>
    Task AddAsync(User user, CancellationToken ct = default);

    /// <summary>
    /// Updates an existing user in the repository.
    /// </summary>
    /// <param name="user">The user to update.</param>
    /// <param name="ct">Cancellation token.</param>
    Task UpdateAsync(User user, CancellationToken ct = default);
}
