using PitchMate.Domain.Entities;
using PitchMate.Domain.Repositories;
using PitchMate.Domain.ValueObjects;

namespace PitchMate.Application.Commands.Squads;

/// <summary>
/// Handler for CreateSquadCommand.
/// Creates a squad with the creator as an admin and persists it.
/// </summary>
public class CreateSquadCommandHandler
{
    private readonly ISquadRepository _squadRepository;
    private readonly IUserRepository _userRepository;

    public CreateSquadCommandHandler(ISquadRepository squadRepository, IUserRepository userRepository)
    {
        _squadRepository = squadRepository ?? throw new ArgumentNullException(nameof(squadRepository));
        _userRepository = userRepository ?? throw new ArgumentNullException(nameof(userRepository));
    }

    /// <summary>
    /// Handles the CreateSquadCommand.
    /// </summary>
    /// <param name="command">The command containing squad name and creator ID.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>Result indicating success or failure with error details.</returns>
    public async Task<CreateSquadResult> HandleAsync(CreateSquadCommand command, CancellationToken ct = default)
    {
        if (command == null)
            throw new ArgumentNullException(nameof(command));

        // Validate squad name
        if (string.IsNullOrWhiteSpace(command.Name))
        {
            return new CreateSquadResult(
                SquadId: null,
                Success: false,
                ErrorCode: "VAL_001",
                ErrorMessage: "Squad name cannot be empty.");
        }

        if (command.CreatorId == null)
        {
            return new CreateSquadResult(
                SquadId: null,
                Success: false,
                ErrorCode: "VAL_001",
                ErrorMessage: "Creator ID cannot be null.");
        }

        try
        {
            // Retrieve user
            var user = await _userRepository.GetByIdAsync(command.CreatorId, ct);
            if (user == null)
            {
                return new CreateSquadResult(
                    SquadId: null,
                    Success: false,
                    ErrorCode: "BUS_004",
                    ErrorMessage: "User not found.");
            }

            // Create squad entity with creator as admin
            var squad = Squad.Create(command.Name, command.CreatorId);

            // Add creator as a member with default rating
            var initialRating = EloRating.Default;
            squad.AddMember(command.CreatorId, initialRating);

            // Add squad membership to user
            user.JoinSquad(squad.Id, initialRating);

            // Persist via repository
            await _squadRepository.AddAsync(squad, ct);
            await _userRepository.UpdateAsync(user, ct);

            return new CreateSquadResult(
                SquadId: squad.Id,
                Success: true);
        }
        catch (ArgumentException ex)
        {
            return new CreateSquadResult(
                SquadId: null,
                Success: false,
                ErrorCode: "VAL_001",
                ErrorMessage: ex.Message);
        }
        catch (Exception ex)
        {
            return new CreateSquadResult(
                SquadId: null,
                Success: false,
                ErrorCode: "INF_001",
                ErrorMessage: $"Failed to create squad: {ex.Message}");
        }
    }
}
