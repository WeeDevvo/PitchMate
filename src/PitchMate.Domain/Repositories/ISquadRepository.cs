using PitchMate.Domain.Entities;
using PitchMate.Domain.ValueObjects;

namespace PitchMate.Domain.Repositories;

/// <summary>
/// Repository interface for Squad aggregate operations.
/// Defines data persistence contracts for the domain layer without framework dependencies.
/// </summary>
public interface ISquadRepository
{
    /// <summary>
    /// Retrieves a squad by its unique identifier.
    /// </summary>
    /// <param name="id">The squad's unique identifier.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>The squad if found, otherwise null.</returns>
    Task<Squad?> GetByIdAsync(SquadId id, CancellationToken ct = default);

    /// <summary>
    /// Retrieves all squads that a user is a member of.
    /// </summary>
    /// <param name="userId">The user's unique identifier.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>A read-only list of squads the user belongs to.</returns>
    Task<IReadOnlyList<Squad>> GetSquadsForUserAsync(UserId userId, CancellationToken ct = default);

    /// <summary>
    /// Adds a new squad to the repository.
    /// </summary>
    /// <param name="squad">The squad to add.</param>
    /// <param name="ct">Cancellation token.</param>
    Task AddAsync(Squad squad, CancellationToken ct = default);

    /// <summary>
    /// Updates an existing squad in the repository.
    /// </summary>
    /// <param name="squad">The squad to update.</param>
    /// <param name="ct">Cancellation token.</param>
    Task UpdateAsync(Squad squad, CancellationToken ct = default);
}
