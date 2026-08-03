using Microsoft.EntityFrameworkCore;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Domain.Matches;
using PitchMate.Infrastructure.Persistence;

namespace PitchMate.Infrastructure.Matches.Repositories;

/// <summary>
/// EF Core implementation of <see cref="IMatchRepository"/> over the shared
/// <see cref="PitchMateDbContext"/>. Registered scoped so it shares the request's unit-of-work
/// transaction: adds are staged on the change tracker and committed by the surrounding
/// <c>IUnitOfWork.SaveChangesAsync</c>. Default reads honour the global soft-delete query filter.
/// <para>
/// The match's owned value objects — its <see cref="Match.CandidateDays"/>, the immutable
/// <see cref="Match.KickoffLineup"/>, and the <see cref="Match.RecordedResult"/> — are <c>jsonb</c>
/// columns on the match row itself and so load with the aggregate root; the child
/// <see cref="Match.Participants"/> and <see cref="Match.Teams"/> tables are eagerly loaded for
/// <see cref="GetByIdAsync"/> so the lifecycle use cases operate on the full graph (Requirement 16.2,
/// 16.3). A split query avoids the cartesian blow-up of joining two collections in one statement.
/// </para>
/// <para>
/// Chronological completed ordering is evaluated inside the database: completed matches ordered by
/// <see cref="Match.CompletedAt"/> ascending then <see cref="Domain.Common.BaseEntity.Id"/> ascending.
/// PostgreSQL sorts <c>uuid</c> values in canonical big-endian order, which for GUID v7 identifiers is
/// creation order, so the pair forms the same stable total order as the in-memory
/// <see cref="CompletedMatchOrder"/> (Requirement 12.4). Filtering on
/// <see cref="MatchState.Completed"/> excludes cancelled — and any not-yet-completed — matches
/// (Requirement 15.5).
/// </para>
/// <para>Validates: Requirements 16.3, 12.4.</para>
/// </summary>
internal sealed class EfMatchRepository(PitchMateDbContext db) : IMatchRepository
{
    /// <inheritdoc />
    public async Task AddAsync(Match match, CancellationToken cancellationToken)
        => await db.Set<Match>().AddAsync(match, cancellationToken);

    /// <inheritdoc />
    public Task<Match?> GetByIdAsync(Guid matchId, CancellationToken cancellationToken)
        // Eagerly load the participants/teams graph the lifecycle use cases mutate; the result and
        // kickoff lineup are jsonb columns on the match row and load with it. The global soft-delete
        // query filter (e => !e.IsDeleted) excludes deleted rows.
        => db.Set<Match>()
            .Include(match => match.Participants)
            .Include(match => match.Teams)
            .AsSplitQuery()
            .FirstOrDefaultAsync(match => match.Id == matchId, cancellationToken);

    /// <inheritdoc />
    public async Task<IReadOnlyList<Match>> GetForSquadAsync(Guid squadId, CancellationToken cancellationToken)
        => await db.Set<Match>()
            .Where(match => match.SquadId == squadId)
            .ToListAsync(cancellationToken);

    /// <inheritdoc />
    public async Task<IReadOnlyList<Match>> ListChronologicalCompletedForSquadAsync(
        Guid squadId, CancellationToken cancellationToken)
        // Completed matches of the squad in the stable replay order, evaluated in the database:
        // CompletedAt ascending, tie-broken by the uuid Id (v7 byte order == creation order), matching
        // CompletedMatchOrder. The Completed filter excludes cancelled and not-yet-completed matches
        // (Requirement 12.4, 15.5).
        => await db.Set<Match>()
            .Where(match => match.SquadId == squadId && match.State == MatchState.Completed)
            .OrderBy(match => match.CompletedAt)
            .ThenBy(match => match.Id)
            .ToListAsync(cancellationToken);
}
