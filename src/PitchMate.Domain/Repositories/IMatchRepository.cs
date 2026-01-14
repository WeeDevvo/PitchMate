using PitchMate.Domain.Entities;
using PitchMate.Domain.ValueObjects;

namespace PitchMate.Domain.Repositories;

/// <summary>
/// Repository interface for Match aggregate operations.
/// Defines data persistence contracts for the domain layer without framework dependencies.
/// </summary>
public interface IMatchRepository
{
    /// <summary>
    /// Retrieves a match by its unique identifier.
    /// </summary>
    /// <param name="id">The match's unique identifier.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>The match if found, otherwise null.</returns>
    Task<Match?> GetByIdAsync(MatchId id, CancellationToken ct = default);

    /// <summary>
    /// Retrieves all matches for a specific squad.
    /// </summary>
    /// <param name="squadId">The squad's unique identifier.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>A read-only list of matches for the squad.</returns>
    Task<IReadOnlyList<Match>> GetMatchesForSquadAsync(SquadId squadId, CancellationToken ct = default);

    /// <summary>
    /// Adds a new match to the repository.
    /// </summary>
    /// <param name="match">The match to add.</param>
    /// <param name="ct">Cancellation token.</param>
    Task AddAsync(Match match, CancellationToken ct = default);

    /// <summary>
    /// Updates an existing match in the repository.
    /// </summary>
    /// <param name="match">The match to update.</param>
    /// <param name="ct">Cancellation token.</param>
    Task UpdateAsync(Match match, CancellationToken ct = default);
}
