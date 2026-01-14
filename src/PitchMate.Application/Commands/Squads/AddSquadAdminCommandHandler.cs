using PitchMate.Domain.Repositories;

namespace PitchMate.Application.Commands.Squads;

/// <summary>
/// Handler for AddSquadAdminCommand.
/// Validates requesting user is admin and adds target user as admin.
/// </summary>
public class AddSquadAdminCommandHandler
{
    private readonly ISquadRepository _squadRepository;

    public AddSquadAdminCommandHandler(ISquadRepository squadRepository)
    {
        _squadRepository = squadRepository ?? throw new ArgumentNullException(nameof(squadRepository));
    }

    /// <summary>
    /// Handles the AddSquadAdminCommand.
    /// </summary>
    /// <param name="command">The command containing squad ID, requesting user ID, and target user ID.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>Result indicating success or failure with error details.</returns>
    public async Task<AddSquadAdminResult> HandleAsync(AddSquadAdminCommand command, CancellationToken ct = default)
    {
        if (command == null)
            throw new ArgumentNullException(nameof(command));

        if (command.SquadId == null)
        {
            return new AddSquadAdminResult(
                Success: false,
                ErrorCode: "VAL_001",
                ErrorMessage: "Squad ID cannot be null.");
        }

        if (command.RequestingUserId == null)
        {
            return new AddSquadAdminResult(
                Success: false,
                ErrorCode: "VAL_001",
                ErrorMessage: "Requesting user ID cannot be null.");
        }

        if (command.TargetUserId == null)
        {
            return new AddSquadAdminResult(
                Success: false,
                ErrorCode: "VAL_001",
                ErrorMessage: "Target user ID cannot be null.");
        }

        try
        {
            // Retrieve squad
            var squad = await _squadRepository.GetByIdAsync(command.SquadId, ct);
            if (squad == null)
            {
                return new AddSquadAdminResult(
                    Success: false,
                    ErrorCode: "BUS_004",
                    ErrorMessage: "Squad not found.");
            }

            // Validate requesting user is admin
            if (!squad.IsAdmin(command.RequestingUserId))
            {
                return new AddSquadAdminResult(
                    Success: false,
                    ErrorCode: "AUTHZ_001",
                    ErrorMessage: "User is not a squad admin.");
            }

            // Add target user as admin
            squad.AddAdmin(command.TargetUserId);

            // Persist changes
            await _squadRepository.UpdateAsync(squad, ct);

            return new AddSquadAdminResult(Success: true);
        }
        catch (InvalidOperationException ex)
        {
            return new AddSquadAdminResult(
                Success: false,
                ErrorCode: "BUS_004",
                ErrorMessage: ex.Message);
        }
        catch (Exception ex)
        {
            return new AddSquadAdminResult(
                Success: false,
                ErrorCode: "INF_001",
                ErrorMessage: $"Failed to add squad admin: {ex.Message}");
        }
    }
}
