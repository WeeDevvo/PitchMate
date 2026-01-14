using PitchMate.Domain.Repositories;
using PitchMate.Domain.Services;
using PitchMate.Domain.ValueObjects;

namespace PitchMate.Application.Commands.Matches;

/// <summary>
/// Handler for RecordMatchResultCommand.
/// Validates admin privileges, records result, calculates ELO changes, and updates player ratings.
/// </summary>
public class RecordMatchResultCommandHandler
{
    private readonly IMatchRepository _matchRepository;
    private readonly ISquadRepository _squadRepository;
    private readonly IEloCalculationService _eloCalculationService;
    private const int DefaultKFactor = 32;

    public RecordMatchResultCommandHandler(
        IMatchRepository matchRepository,
        ISquadRepository squadRepository,
        IEloCalculationService eloCalculationService)
    {
        _matchRepository = matchRepository ?? throw new ArgumentNullException(nameof(matchRepository));
        _squadRepository = squadRepository ?? throw new ArgumentNullException(nameof(squadRepository));
        _eloCalculationService = eloCalculationService ?? throw new ArgumentNullException(nameof(eloCalculationService));
    }

    /// <summary>
    /// Handles the RecordMatchResultCommand.
    /// </summary>
    /// <param name="command">The command containing match result details.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>Result indicating success or failure with error details.</returns>
    public async Task<RecordMatchResultResult> HandleAsync(RecordMatchResultCommand command, CancellationToken ct = default)
    {
        if (command == null)
            throw new ArgumentNullException(nameof(command));

        // Get the match
        var match = await _matchRepository.GetByIdAsync(command.MatchId, ct);
        if (match == null)
        {
            return new RecordMatchResultResult(
                Success: false,
                ErrorCode: "BUS_004",
                ErrorMessage: "Match not found.");
        }

        // Get the squad
        var squad = await _squadRepository.GetByIdAsync(match.SquadId, ct);
        if (squad == null)
        {
            return new RecordMatchResultResult(
                Success: false,
                ErrorCode: "BUS_004",
                ErrorMessage: "Squad not found.");
        }

        // Requirement 6.1: Validate requesting user is squad admin
        if (!squad.IsAdmin(command.RequestingUserId))
        {
            return new RecordMatchResultResult(
                Success: false,
                ErrorCode: "AUTHZ_001",
                ErrorMessage: "User is not a squad admin.");
        }

        // Requirement 6.6: Validate match can accept result (not already completed)
        if (!match.CanRecordResult())
        {
            return new RecordMatchResultResult(
                Success: false,
                ErrorCode: "BUS_002",
                ErrorMessage: "Match result has already been recorded.");
        }

        // Validate teams are assigned
        if (match.TeamA == null || match.TeamB == null)
        {
            return new RecordMatchResultResult(
                Success: false,
                ErrorCode: "BUS_001",
                ErrorMessage: "Match teams have not been assigned.");
        }

        try
        {
            // Requirement 6.2, 6.3, 6.7: Record result with timestamp
            match.RecordResult(command.Winner, command.BalanceFeedback);

            // Requirement 5.1: Calculate ELO changes using IEloCalculationService
            var ratingChanges = _eloCalculationService.CalculateRatingChanges(
                match.TeamA,
                match.TeamB,
                command.Winner,
                DefaultKFactor);

            // Requirement 6.4, 5.7: Update player ratings in squad memberships
            foreach (var (userId, ratingChange) in ratingChanges)
            {
                var membership = squad.GetMembershipForUser(userId);
                var newRating = EloRating.Create(membership.CurrentRating.Value + ratingChange);
                squad.UpdateMemberRating(userId, newRating);
            }

            // Persist changes
            await _matchRepository.UpdateAsync(match, ct);
            await _squadRepository.UpdateAsync(squad, ct);

            return new RecordMatchResultResult(Success: true);
        }
        catch (ArgumentException ex)
        {
            return new RecordMatchResultResult(
                Success: false,
                ErrorCode: "VAL_001",
                ErrorMessage: ex.Message);
        }
        catch (InvalidOperationException ex)
        {
            return new RecordMatchResultResult(
                Success: false,
                ErrorCode: "BUS_001",
                ErrorMessage: ex.Message);
        }
        catch (Exception ex)
        {
            return new RecordMatchResultResult(
                Success: false,
                ErrorCode: "INF_001",
                ErrorMessage: $"Failed to record match result: {ex.Message}");
        }
    }
}
