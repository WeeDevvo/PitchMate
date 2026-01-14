using PitchMate.Domain.Repositories;
using PitchMate.Domain.ValueObjects;

namespace PitchMate.Application.Queries;

/// <summary>
/// Handler for GetUserSquadsQuery.
/// Retrieves all squads that a user is a member of, including their rating and admin status.
/// </summary>
public class GetUserSquadsQueryHandler
{
    private readonly ISquadRepository _squadRepository;
    private readonly IUserRepository _userRepository;

    public GetUserSquadsQueryHandler(ISquadRepository squadRepository, IUserRepository userRepository)
    {
        _squadRepository = squadRepository ?? throw new ArgumentNullException(nameof(squadRepository));
        _userRepository = userRepository ?? throw new ArgumentNullException(nameof(userRepository));
    }

    /// <summary>
    /// Handles the GetUserSquadsQuery.
    /// </summary>
    /// <param name="query">The query containing the user ID.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>Result containing the list of squads with user's rating and admin status.</returns>
    public async Task<GetUserSquadsResult> HandleAsync(GetUserSquadsQuery query, CancellationToken ct = default)
    {
        if (query == null)
            throw new ArgumentNullException(nameof(query));

        if (query.UserId == null)
        {
            return new GetUserSquadsResult(
                Squads: Array.Empty<SquadDto>(),
                Success: false,
                ErrorCode: "VAL_001",
                ErrorMessage: "User ID cannot be null.");
        }

        try
        {
            // Get user to access squad memberships
            var user = await _userRepository.GetByIdAsync(query.UserId, ct);
            if (user == null)
            {
                return new GetUserSquadsResult(
                    Squads: Array.Empty<SquadDto>(),
                    Success: false,
                    ErrorCode: "BUS_001",
                    ErrorMessage: "User not found.");
            }

            // Get all squads for the user
            var squads = await _squadRepository.GetSquadsForUserAsync(query.UserId, ct);

            // Build DTOs with rating and admin status
            var squadDtos = squads.Select(squad =>
            {
                var membership = user.SquadMemberships.FirstOrDefault(m => m.SquadId.Equals(squad.Id));
                var isAdmin = squad.IsAdmin(query.UserId);

                return new SquadDto(
                    SquadId: squad.Id,
                    Name: squad.Name,
                    CurrentRating: membership?.CurrentRating ?? EloRating.Default,
                    JoinedAt: membership?.JoinedAt ?? DateTime.MinValue,
                    IsAdmin: isAdmin);
            }).ToList();

            return new GetUserSquadsResult(
                Squads: squadDtos,
                Success: true);
        }
        catch (Exception ex)
        {
            return new GetUserSquadsResult(
                Squads: Array.Empty<SquadDto>(),
                Success: false,
                ErrorCode: "INF_001",
                ErrorMessage: $"Failed to retrieve user squads: {ex.Message}");
        }
    }
}
