using PitchMate.Domain.Matches;

namespace PitchMate.Application.Matches.Abstractions;

/// <summary>
/// Match-specific persistence operations that must run inside the database (aggregate-graph
/// loading, squad-scoped listing, chronological completed ordering). Declared in Application so
/// use cases stay free of EF Core / Npgsql types; implemented in Infrastructure over the
/// <c>PitchMateDbContext</c> (Requirement 16.2, 19.2). Generic CRUD is covered by
/// <see cref="Common.Persistence.IRepository{T}"/>; this interface adds the match lookups that
/// generic CRUD cannot express.
/// </summary>
public interface IMatchRepository
{
    /// <summary>Stages an insert of <paramref name="match"/>; the row is written on the unit-of-work commit.</summary>
    /// <param name="match">The match to add.</param>
    /// <param name="cancellationToken">A token that surfaces cancellation to the caller.</param>
    Task AddAsync(Match match, CancellationToken cancellationToken);

    /// <summary>
    /// Retrieves the match whose identity equals <paramref name="matchId"/>, eagerly loading the full
    /// aggregate graph the lifecycle use cases operate on — its participants, working teams, and
    /// recorded result. Returns <see langword="null"/> when none matches (Requirement 16.2).
    /// </summary>
    /// <param name="matchId">The match identity to look up.</param>
    /// <param name="cancellationToken">A token that surfaces cancellation to the caller.</param>
    /// <returns>The matching match with its participants/teams/result graph loaded, or <see langword="null"/>.</returns>
    Task<Match?> GetByIdAsync(Guid matchId, CancellationToken cancellationToken);

    /// <summary>
    /// Lists the matches belonging to <paramref name="squadId"/>, so squad-scoped views can present a
    /// squad's matches (Requirement 16.2). Returns an empty list when none match.
    /// </summary>
    /// <param name="squadId">The squad whose matches are listed.</param>
    /// <param name="cancellationToken">A token that surfaces cancellation to the caller.</param>
    /// <returns>The squad's matches, or an empty list.</returns>
    Task<IReadOnlyList<Match>> GetForSquadAsync(Guid squadId, CancellationToken cancellationToken);

    /// <summary>
    /// Lists the completed matches of <paramref name="squadId"/> in the stable replay order —
    /// <see cref="Match.CompletedAt"/> ascending, tie-broken by <see cref="Domain.Common.BaseEntity.Id"/>
    /// via the UUID v7 byte sequence — excluding cancelled matches, sufficient for the rating-engine
    /// replay use case (Requirement 12.4). The ordering is evaluated within the database. Returns an
    /// empty list when the squad has no completed matches.
    /// </summary>
    /// <param name="squadId">The squad whose completed matches are listed in replay order.</param>
    /// <param name="cancellationToken">A token that surfaces cancellation to the caller.</param>
    /// <returns>The squad's completed matches in chronological replay order, or an empty list.</returns>
    Task<IReadOnlyList<Match>> ListChronologicalCompletedForSquadAsync(Guid squadId, CancellationToken cancellationToken);
}
