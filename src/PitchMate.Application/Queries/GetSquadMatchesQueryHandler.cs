using PitchMate.Domain.Repositories;

namespace PitchMate.Application.Queries;

/// <summary>
/// Handler for GetSquadMatchesQuery.
/// Retrieves all matches for a specific squad.
/// </summary>
public class GetSquadMatchesQueryHandler
{
    private readonly IMatchRepository _matchRepository;

    public GetSquadMatchesQueryHandler(IMatchRepository matchRepository)
    {
        _matchRepository = matchRepository ?? throw new ArgumentNullException(nameof(matchRepository));
    }

    /// <summary>
    /// Handles the GetSquadMatchesQuery.
    /// </summary>
    /// <param name="query">The query containing the squad ID.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>Result containing the list of matches for the squad.</returns>
    public async Task<GetSquadMatchesResult> HandleAsync(GetSquadMatchesQuery query, CancellationToken ct = default)
    {
        if (query == null)
            throw new ArgumentNullException(nameof(query));

        if (query.SquadId == null)
        {
            return new GetSquadMatchesResult(
                Matches: Array.Empty<MatchDto>(),
                Success: false,
                ErrorCode: "VAL_001",
                ErrorMessage: "Squad ID cannot be null.");
        }

        try
        {
            // Get all matches for the squad
            var matches = await _matchRepository.GetMatchesForSquadAsync(query.SquadId, ct);

            // Build DTOs
            var matchDtos = matches.Select(match => new MatchDto(
                MatchId: match.Id,
                ScheduledAt: match.ScheduledAt,
                TeamSize: match.TeamSize,
                Status: match.Status,
                PlayerCount: match.Players.Count,
                Winner: match.Result?.Winner,
                CompletedAt: match.Result?.RecordedAt
            )).ToList();

            return new GetSquadMatchesResult(
                Matches: matchDtos,
                Success: true);
        }
        catch (Exception ex)
        {
            return new GetSquadMatchesResult(
                Matches: Array.Empty<MatchDto>(),
                Success: false,
                ErrorCode: "INF_001",
                ErrorMessage: $"Failed to retrieve squad matches: {ex.Message}");
        }
    }
}
