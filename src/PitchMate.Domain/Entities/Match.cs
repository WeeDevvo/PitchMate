using PitchMate.Domain.ValueObjects;

namespace PitchMate.Domain.Entities;

/// <summary>
/// Match aggregate root representing a scheduled game between two teams within a squad.
/// </summary>
public class Match
{
    public MatchId Id { get; private set; }
    public SquadId SquadId { get; private set; }
    public DateTime ScheduledAt { get; private set; }
    public int TeamSize { get; private set; }
    public MatchStatus Status { get; private set; }
    public DateTime CreatedAt { get; private set; }

    private readonly List<MatchPlayer> _players;
    public IReadOnlyCollection<MatchPlayer> Players => _players.AsReadOnly();

    private Team? _teamA;
    private Team? _teamB;
    public Team? TeamA => _teamA;
    public Team? TeamB => _teamB;

    public MatchResult? Result { get; private set; }

    // Private constructor for EF Core
    private Match()
    {
        Id = null!;
        SquadId = null!;
        _players = new List<MatchPlayer>();
    }

    private Match(MatchId id, SquadId squadId, DateTime scheduledAt, int teamSize, List<MatchPlayer> players)
    {
        Id = id ?? throw new ArgumentNullException(nameof(id));
        SquadId = squadId ?? throw new ArgumentNullException(nameof(squadId));
        ScheduledAt = scheduledAt;
        TeamSize = teamSize;
        Status = MatchStatus.Pending;
        CreatedAt = DateTime.UtcNow;
        _players = players ?? throw new ArgumentNullException(nameof(players));
    }

    /// <summary>
    /// Creates a new match with the specified parameters.
    /// Validates that player count is even and at least 2.
    /// </summary>
    public static Match Create(SquadId squadId, DateTime scheduledAt, IEnumerable<MatchPlayer> players, int teamSize = 5)
    {
        if (squadId == null)
            throw new ArgumentNullException(nameof(squadId));
        if (players == null)
            throw new ArgumentNullException(nameof(players));

        var playerList = players.ToList();

        // Requirement 3.5: Validate minimum player count
        if (playerList.Count < 2)
        {
            throw new ArgumentException("Match must have at least 2 players.", nameof(players));
        }

        // Requirement 3.4: Validate even player count
        if (playerList.Count % 2 != 0)
        {
            throw new ArgumentException("Match must have an even number of players.", nameof(players));
        }

        if (teamSize <= 0)
        {
            throw new ArgumentException("Team size must be greater than zero.", nameof(teamSize));
        }

        return new Match(
            MatchId.NewId(),
            squadId,
            scheduledAt,
            teamSize,
            playerList);
    }

    /// <summary>
    /// Assigns balanced teams to the match.
    /// </summary>
    public void AssignTeams(Team teamA, Team teamB)
    {
        if (teamA == null)
            throw new ArgumentNullException(nameof(teamA));
        if (teamB == null)
            throw new ArgumentNullException(nameof(teamB));

        // Validate that teams contain the correct players
        var allTeamPlayers = teamA.Players.Concat(teamB.Players).ToList();
        if (allTeamPlayers.Count != _players.Count)
        {
            throw new InvalidOperationException("Team assignments must include all match players.");
        }

        // Validate that all players in teams are in the match
        var teamPlayerIds = allTeamPlayers.Select(p => p.UserId).ToHashSet();
        var matchPlayerIds = _players.Select(p => p.UserId).ToHashSet();
        if (!teamPlayerIds.SetEquals(matchPlayerIds))
        {
            throw new InvalidOperationException("Team assignments must include exactly the match players.");
        }

        _teamA = teamA;
        _teamB = teamB;
    }

    /// <summary>
    /// Records the result of the match and updates status to completed.
    /// </summary>
    public void RecordResult(TeamDesignation winner, string? balanceFeedback = null)
    {
        // Requirement 6.6: Prevent duplicate result submission
        if (!CanRecordResult())
        {
            throw new InvalidOperationException("Cannot record result for a match that is already completed.");
        }

        Result = MatchResult.Create(winner, balanceFeedback);
        Status = MatchStatus.Completed;
    }

    /// <summary>
    /// Determines if a result can be recorded for this match.
    /// </summary>
    public bool CanRecordResult()
    {
        return Status != MatchStatus.Completed;
    }
}
