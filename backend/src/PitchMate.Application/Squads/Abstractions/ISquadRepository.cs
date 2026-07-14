using PitchMate.Domain.Squads;

namespace PitchMate.Application.Squads.Abstractions;

/// <summary>
/// Squad-specific persistence operations that must run inside the database (soft-delete filtering,
/// per-user membership scans, purge-due listing). Declared in Application so use cases stay free of
/// EF Core / Npgsql types; implemented in Infrastructure over the <c>PitchMateDbContext</c>
/// (Requirement 19.2, 19.3). Generic CRUD is covered by <see cref="Common.Persistence.IRepository{T}"/>;
/// this interface adds the squad lookups that generic CRUD cannot express.
/// </summary>
public interface ISquadRepository
{
    /// <summary>Stages an insert of <paramref name="squad"/>; the row is written on the unit-of-work commit.</summary>
    /// <param name="squad">The squad to add.</param>
    /// <param name="cancellationToken">A token that surfaces cancellation to the caller.</param>
    Task AddAsync(Squad squad, CancellationToken cancellationToken);

    /// <summary>
    /// Retrieves the squad whose identity equals <paramref name="squadId"/>, excluding soft-deleted
    /// (pending-deletion) squads. Returns <see langword="null"/> when none matches (Requirement 16.4, 17.3).
    /// </summary>
    /// <param name="squadId">The squad identity to look up.</param>
    /// <param name="cancellationToken">A token that surfaces cancellation to the caller.</param>
    /// <returns>The matching non-deleted squad, or <see langword="null"/>.</returns>
    Task<Squad?> GetByIdAsync(Guid squadId, CancellationToken cancellationToken);

    /// <summary>
    /// Retrieves the squad whose identity equals <paramref name="squadId"/> including soft-deleted
    /// squads, for the undelete, export, and purge paths (Requirement 17.2, 17.4, 17.5). Returns
    /// <see langword="null"/> when none matches.
    /// </summary>
    /// <param name="squadId">The squad identity to look up.</param>
    /// <param name="cancellationToken">A token that surfaces cancellation to the caller.</param>
    /// <returns>The matching squad including soft-deleted, or <see langword="null"/>.</returns>
    Task<Squad?> GetByIdIncludingDeletedAsync(Guid squadId, CancellationToken cancellationToken);

    /// <summary>
    /// Lists the non-deleted squads in which <paramref name="userId"/> holds a membership, for the
    /// user's squad list (Requirement 16.4). Returns an empty list when none match.
    /// </summary>
    /// <param name="userId">The user whose squads are listed.</param>
    /// <param name="cancellationToken">A token that surfaces cancellation to the caller.</param>
    /// <returns>The user's non-deleted squads, or an empty list.</returns>
    Task<IReadOnlyList<Squad>> ListForUserAsync(Guid userId, CancellationToken cancellationToken);

    /// <summary>
    /// Lists the soft-deleted squads whose purge instant is at or before <paramref name="now"/>, so
    /// the purge use case can remove them after the grace period (Requirement 17.5). Returns an empty
    /// list when none are due.
    /// </summary>
    /// <param name="now">The current clock instant.</param>
    /// <param name="cancellationToken">A token that surfaces cancellation to the caller.</param>
    /// <returns>The squads due for purge, or an empty list.</returns>
    Task<IReadOnlyList<Squad>> ListPurgeDueAsync(DateTimeOffset now, CancellationToken cancellationToken);

    /// <summary>
    /// Stages a <b>permanent</b> removal of <paramref name="squad"/> for the purge path, so the row
    /// is genuinely deleted rather than soft-deleted when
    /// <see cref="Common.Persistence.IUnitOfWork.SaveChangesAsync"/> commits (Requirement 17.5).
    /// Unlike <see cref="Common.Persistence.IRepository{T}.Remove"/>, which the save pipeline
    /// reinterprets as a soft-delete for every <c>BaseEntity</c>, this bypasses soft-delete so an
    /// already soft-deleted squad reaching its purge instant is erased for good. Synchronous because
    /// it only mutates tracked state; the write happens on the unit-of-work commit.
    /// </summary>
    /// <param name="squad">The soft-deleted squad to remove permanently.</param>
    void RemovePermanently(Squad squad);
}
