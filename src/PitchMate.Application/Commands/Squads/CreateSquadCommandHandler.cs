using PitchMate.Domain.Entities;
using PitchMate.Domain.Repositories;

namespace PitchMate.Application.Commands.Squads;

/// <summary>
/// Handler for CreateSquadCommand.
/// Creates a squad with the creator as an admin and persists it.
/// </summary>
public class CreateSquadCommandHandler
{
    private readonly ISquadRepository _squadRepository;

    public CreateSquadCommandHandler(ISquadRepository squadRepository)
    {
        _squadRepository = squadRepository ?? throw new ArgumentNullException(nameof(squadRepository));
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
            // Create squad entity with creator as admin
            var squad = Squad.Create(command.Name, command.CreatorId);

            // Persist via repository
            await _squadRepository.AddAsync(squad, ct);

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
