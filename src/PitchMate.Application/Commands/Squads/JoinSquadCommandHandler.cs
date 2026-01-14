using PitchMate.Domain.Repositories;
using PitchMate.Domain.ValueObjects;

namespace PitchMate.Application.Commands.Squads;

/// <summary>
/// Handler for JoinSquadCommand.
/// Adds a user to a squad with initial rating (1000 or configured default) and prevents duplicate membership.
/// </summary>
public class JoinSquadCommandHandler
{
    private readonly IUserRepository _userRepository;
    private readonly ISquadRepository _squadRepository;

    public JoinSquadCommandHandler(IUserRepository userRepository, ISquadRepository squadRepository)
    {
        _userRepository = userRepository ?? throw new ArgumentNullException(nameof(userRepository));
        _squadRepository = squadRepository ?? throw new ArgumentNullException(nameof(squadRepository));
    }

    /// <summary>
    /// Handles the JoinSquadCommand.
    /// </summary>
    /// <param name="command">The command containing user ID and squad ID.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>Result indicating success or failure with error details.</returns>
    public async Task<JoinSquadResult> HandleAsync(JoinSquadCommand command, CancellationToken ct = default)
    {
        if (command == null)
            throw new ArgumentNullException(nameof(command));

        if (command.UserId == null)
        {
            return new JoinSquadResult(
                Success: false,
                ErrorCode: "VAL_001",
                ErrorMessage: "User ID cannot be null.");
        }

        if (command.SquadId == null)
        {
            return new JoinSquadResult(
                Success: false,
                ErrorCode: "VAL_001",
                ErrorMessage: "Squad ID cannot be null.");
        }

        try
        {
            // Retrieve user
            var user = await _userRepository.GetByIdAsync(command.UserId, ct);
            if (user == null)
            {
                return new JoinSquadResult(
                    Success: false,
                    ErrorCode: "BUS_004",
                    ErrorMessage: "User not found.");
            }

            // Retrieve squad
            var squad = await _squadRepository.GetByIdAsync(command.SquadId, ct);
            if (squad == null)
            {
                return new JoinSquadResult(
                    Success: false,
                    ErrorCode: "BUS_004",
                    ErrorMessage: "Squad not found.");
            }

            // Check if user is already a member (prevent duplicate membership)
            if (squad.IsMember(command.UserId))
            {
                return new JoinSquadResult(
                    Success: false,
                    ErrorCode: "BUS_001",
                    ErrorMessage: "User is already a member of this squad.");
            }

            // Use default initial rating of 1000
            var initialRating = EloRating.Default;

            // Add user to squad
            squad.AddMember(command.UserId, initialRating);
            
            // Add squad membership to user
            user.JoinSquad(command.SquadId, initialRating);

            // Persist changes
            await _squadRepository.UpdateAsync(squad, ct);
            await _userRepository.UpdateAsync(user, ct);

            return new JoinSquadResult(Success: true);
        }
        catch (InvalidOperationException ex)
        {
            return new JoinSquadResult(
                Success: false,
                ErrorCode: "BUS_001",
                ErrorMessage: ex.Message);
        }
        catch (Exception ex)
        {
            return new JoinSquadResult(
                Success: false,
                ErrorCode: "INF_001",
                ErrorMessage: $"Failed to join squad: {ex.Message}");
        }
    }
}
