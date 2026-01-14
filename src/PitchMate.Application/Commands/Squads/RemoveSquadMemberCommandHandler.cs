using PitchMate.Domain.Repositories;

namespace PitchMate.Application.Commands.Squads;

/// <summary>
/// Handler for RemoveSquadMemberCommand.
/// Validates requesting user is admin and removes member while preserving rating history.
/// </summary>
public class RemoveSquadMemberCommandHandler
{
    private readonly ISquadRepository _squadRepository;

    public RemoveSquadMemberCommandHandler(ISquadRepository squadRepository)
    {
        _squadRepository = squadRepository ?? throw new ArgumentNullException(nameof(squadRepository));
    }

    /// <summary>
    /// Handles the RemoveSquadMemberCommand.
    /// </summary>
    /// <param name="command">The command containing squad ID, requesting user ID, and target user ID.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>Result indicating success or failure with error details.</returns>
    public async Task<RemoveSquadMemberResult> HandleAsync(RemoveSquadMemberCommand command, CancellationToken ct = default)
    {
        if (command == null)
            throw new ArgumentNullException(nameof(command));

        if (command.SquadId == null)
        {
            return new RemoveSquadMemberResult(
                Success: false,
                ErrorCode: "VAL_001",
                ErrorMessage: "Squad ID cannot be null.");
        }

        if (command.RequestingUserId == null)
        {
            return new RemoveSquadMemberResult(
                Success: false,
                ErrorCode: "VAL_001",
                ErrorMessage: "Requesting user ID cannot be null.");
        }

        if (command.TargetUserId == null)
        {
            return new RemoveSquadMemberResult(
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
                return new RemoveSquadMemberResult(
                    Success: false,
                    ErrorCode: "BUS_004",
                    ErrorMessage: "Squad not found.");
            }

            // Validate requesting user is admin
            if (!squad.IsAdmin(command.RequestingUserId))
            {
                return new RemoveSquadMemberResult(
                    Success: false,
                    ErrorCode: "AUTHZ_001",
                    ErrorMessage: "User is not a squad admin.");
            }

            // Remove member (preserves rating history as per domain logic)
            squad.RemoveMember(command.TargetUserId);

            // Persist changes
            await _squadRepository.UpdateAsync(squad, ct);

            return new RemoveSquadMemberResult(Success: true);
        }
        catch (InvalidOperationException ex)
        {
            return new RemoveSquadMemberResult(
                Success: false,
                ErrorCode: "BUS_004",
                ErrorMessage: ex.Message);
        }
        catch (Exception ex)
        {
            return new RemoveSquadMemberResult(
                Success: false,
                ErrorCode: "INF_001",
                ErrorMessage: $"Failed to remove squad member: {ex.Message}");
        }
    }
}
