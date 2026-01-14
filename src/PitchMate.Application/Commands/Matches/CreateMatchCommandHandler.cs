using PitchMate.Domain.Entities;
using PitchMate.Domain.Repositories;
using PitchMate.Domain.Services;
using PitchMate.Domain.ValueObjects;

namespace PitchMate.Application.Commands.Matches;

/// <summary>
/// Handler for CreateMatchCommand.
/// Validates admin privileges, player count, generates balanced teams, and persists the match.
/// </summary>
public class CreateMatchCommandHandler
{
    private readonly ISquadRepository _squadRepository;
    private readonly IMatchRepository _matchRepository;
    private readonly ITeamBalancingService _teamBalancingService;
    private const int DefaultTeamSize = 5;

    public CreateMatchCommandHandler(
        ISquadRepository squadRepository,
        IMatchRepository matchRepository,
        ITeamBalancingService teamBalancingService)
    {
        _squadRepository = squadRepository ?? throw new ArgumentNullException(nameof(squadRepository));
        _matchRepository = matchRepository ?? throw new ArgumentNullException(nameof(matchRepository));
        _teamBalancingService = teamBalancingService ?? throw new ArgumentNullException(nameof(teamBalancingService));
    }

    /// <summary>
    /// Handles the CreateMatchCommand.
    /// </summary>
    /// <param name="command">The command containing match details.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>Result indicating success or failure with error details.</returns>
    public async Task<CreateMatchResult> HandleAsync(CreateMatchCommand command, CancellationToken ct = default)
    {
        if (command == null)
            throw new ArgumentNullException(nameof(command));

        // Requirement 3.1: Validate requesting user is squad admin
        var squad = await _squadRepository.GetByIdAsync(command.SquadId, ct);
        if (squad == null)
        {
            return new CreateMatchResult(
                MatchId: null,
                Success: false,
                ErrorCode: "BUS_004",
                ErrorMessage: "Squad not found.");
        }

        if (!squad.IsAdmin(command.RequestingUserId))
        {
            return new CreateMatchResult(
                MatchId: null,
                Success: false,
                ErrorCode: "AUTHZ_001",
                ErrorMessage: "User is not a squad admin.");
        }

        // Requirement 3.2: Validate required parameters
        if (command.PlayerIds == null || command.PlayerIds.Count == 0)
        {
            return new CreateMatchResult(
                MatchId: null,
                Success: false,
                ErrorCode: "VAL_001",
                ErrorMessage: "Player list cannot be empty.");
        }

        // Requirement 3.5: Validate minimum player count (>= 2)
        if (command.PlayerIds.Count < 2)
        {
            return new CreateMatchResult(
                MatchId: null,
                Success: false,
                ErrorCode: "VAL_004",
                ErrorMessage: "Match must have at least 2 players.");
        }

        // Requirement 3.4: Validate even player count
        if (command.PlayerIds.Count % 2 != 0)
        {
            return new CreateMatchResult(
                MatchId: null,
                Success: false,
                ErrorCode: "VAL_003",
                ErrorMessage: "Match must have an even number of players.");
        }

        // Requirement 3.3: Use default team size if not specified
        var teamSize = command.TeamSize ?? DefaultTeamSize;

        if (teamSize <= 0)
        {
            return new CreateMatchResult(
                MatchId: null,
                Success: false,
                ErrorCode: "VAL_001",
                ErrorMessage: "Team size must be greater than zero.");
        }

        try
        {
            // Requirement 4.1: Get current ELO ratings for each player in this squad
            var matchPlayers = new List<MatchPlayer>();
            foreach (var playerId in command.PlayerIds)
            {
                if (!squad.IsMember(playerId))
                {
                    return new CreateMatchResult(
                        MatchId: null,
                        Success: false,
                        ErrorCode: "BUS_004",
                        ErrorMessage: $"Player {playerId} is not a member of this squad.");
                }

                var membership = squad.GetMembershipForUser(playerId);
                var matchPlayer = MatchPlayer.Create(playerId, membership.CurrentRating);
                matchPlayers.Add(matchPlayer);
            }

            // Create match entity
            var match = Match.Create(
                command.SquadId,
                command.ScheduledAt,
                matchPlayers,
                teamSize);

            // Requirement 4.1, 4.6: Generate balanced teams using ITeamBalancingService
            var (teamA, teamB) = _teamBalancingService.GenerateBalancedTeams(
                matchPlayers.AsReadOnly(),
                teamSize);

            // Requirement 4.6: Persist match with team assignments
            match.AssignTeams(teamA, teamB);

            // Requirement 3.6: Persist match in pending state
            await _matchRepository.AddAsync(match, ct);

            return new CreateMatchResult(
                MatchId: match.Id,
                Success: true);
        }
        catch (ArgumentException ex)
        {
            return new CreateMatchResult(
                MatchId: null,
                Success: false,
                ErrorCode: "VAL_001",
                ErrorMessage: ex.Message);
        }
        catch (InvalidOperationException ex)
        {
            return new CreateMatchResult(
                MatchId: null,
                Success: false,
                ErrorCode: "BUS_001",
                ErrorMessage: ex.Message);
        }
        catch (Exception ex)
        {
            return new CreateMatchResult(
                MatchId: null,
                Success: false,
                ErrorCode: "INF_001",
                ErrorMessage: $"Failed to create match: {ex.Message}");
        }
    }
}
