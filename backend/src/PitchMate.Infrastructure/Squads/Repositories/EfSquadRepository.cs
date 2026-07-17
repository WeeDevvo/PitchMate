using Microsoft.EntityFrameworkCore;
using PitchMate.Application.Squads.Abstractions;
using PitchMate.Domain.Squads;
using PitchMate.Infrastructure.Persistence;

namespace PitchMate.Infrastructure.Squads.Repositories;

/// <summary>
/// EF Core implementation of <see cref="ISquadRepository"/> over the shared
/// <see cref="PitchMateDbContext"/>. Default reads honour the global soft-delete query filter so
/// pending-deletion squads are excluded (Requirement 16.4, 17.3); the undelete, export, and purge
/// paths opt into including soft-deleted rows via <see cref="EntityFrameworkQueryableExtensions.IgnoreQueryFilters{TEntity}(IQueryable{TEntity})"/>.
/// Writes are staged on the change tracker and committed by the unit of work as part of the
/// surrounding transaction.
/// <para>Validates: Requirements 16.4, 17.2, 17.4, 17.5, 19.3.</para>
/// </summary>
internal sealed class EfSquadRepository(PitchMateDbContext db) : ISquadRepository
{
    /// <inheritdoc />
    public async Task AddAsync(Squad squad, CancellationToken cancellationToken)
        => await db.Set<Squad>().AddAsync(squad, cancellationToken);

    /// <inheritdoc />
    public Task<Squad?> GetByIdAsync(Guid squadId, CancellationToken cancellationToken)
        // The global soft-delete query filter (e => !e.IsDeleted) excludes pending-deletion squads.
        => db.Set<Squad>().FirstOrDefaultAsync(squad => squad.Id == squadId, cancellationToken);

    /// <inheritdoc />
    public Task<Squad?> GetByIdIncludingDeletedAsync(Guid squadId, CancellationToken cancellationToken)
        // Bypass the soft-delete filter for the undelete / export / purge paths (Requirement 17.2, 17.4, 17.5).
        => db.Set<Squad>()
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(squad => squad.Id == squadId, cancellationToken);

    /// <inheritdoc />
    public async Task<IReadOnlyList<Squad>> ListForUserAsync(Guid userId, CancellationToken cancellationToken)
        // Non-deleted squads (global filter) in which the user holds any membership, expressed as an
        // EXISTS subquery so PostgreSQL evaluates it (Requirement 16.4).
        => await db.Set<Squad>()
            .Where(squad => db.Set<SquadMembership>()
                .Any(membership => membership.SquadId == squad.Id && membership.UserId == userId))
            .ToListAsync(cancellationToken);

    /// <inheritdoc />
    public async Task<IReadOnlyList<Squad>> ListPurgeDueAsync(DateTimeOffset now, CancellationToken cancellationToken)
        // Soft-deleted squads whose grace period has elapsed (PurgeAt at or before now). Requires
        // bypassing the soft-delete filter since these rows are, by definition, soft-deleted (Requirement 17.5).
        => await db.Set<Squad>()
            .IgnoreQueryFilters()
            .Where(squad => squad.IsDeleted && squad.PurgeAt != null && squad.PurgeAt <= now)
            .ToListAsync(cancellationToken);

    /// <inheritdoc />
    public void RemovePermanently(Squad squad)
    {
        ArgumentNullException.ThrowIfNull(squad);

        // Stage an EF Deleted state and mark it so the save pipeline performs a genuine delete
        // instead of reinterpreting it as a soft-delete (Requirement 17.5). Committed on the
        // unit-of-work save.
        db.Set<Squad>().Remove(squad);
        db.MarkForHardDelete(squad);
    }
}
