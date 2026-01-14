using PitchMate.Domain.Repositories;

namespace PitchMate.Application.Queries;

/// <summary>
/// Handler for GetUserRatingInSquadQuery.
/// Retrieves a user's current rating in a specific squad.
/// </summary>
public class GetUserRatingInSquadQueryHandler
{
    private readonly IUserRepository _userRepository;

    public GetUserRatingInSquadQueryHandler(IUserRepository userRepository)
    {
        _userRepository = userRepository ?? throw new ArgumentNullException(nameof(userRepository));
    }

    /// <summary>
    /// Handles the GetUserRatingInSquadQuery.
    /// </summary>
    /// <param name="query">The query containing the user ID and squad ID.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>Result containing the user's rating in the squad.</returns>
    public async Task<GetUserRatingInSquadResult> HandleAsync(GetUserRatingInSquadQuery query, CancellationToken ct = default)
    {
        if (query == null)
            throw new ArgumentNullException(nameof(query));

        if (query.UserId == null)
        {
            return new GetUserRatingInSquadResult(
                Rating: null,
                Success: false,
                ErrorCode: "VAL_001",
                ErrorMessage: "User ID cannot be null.");
        }

        if (query.SquadId == null)
        {
            return new GetUserRatingInSquadResult(
                Rating: null,
                Success: false,
                ErrorCode: "VAL_001",
                ErrorMessage: "Squad ID cannot be null.");
        }

        try
        {
            // Get user to access squad memberships
            var user = await _userRepository.GetByIdAsync(query.UserId, ct);
            if (user == null)
            {
                return new GetUserRatingInSquadResult(
                    Rating: null,
                    Success: false,
                    ErrorCode: "BUS_001",
                    ErrorMessage: "User not found.");
            }

            // Get membership for the specific squad
            try
            {
                var membership = user.GetMembershipForSquad(query.SquadId);

                var ratingDto = new UserRatingDto(
                    UserId: query.UserId,
                    SquadId: query.SquadId,
                    CurrentRating: membership.CurrentRating,
                    JoinedAt: membership.JoinedAt);

                return new GetUserRatingInSquadResult(
                    Rating: ratingDto,
                    Success: true);
            }
            catch (InvalidOperationException)
            {
                return new GetUserRatingInSquadResult(
                    Rating: null,
                    Success: false,
                    ErrorCode: "BUS_004",
                    ErrorMessage: "User is not a member of the specified squad.");
            }
        }
        catch (Exception ex)
        {
            return new GetUserRatingInSquadResult(
                Rating: null,
                Success: false,
                ErrorCode: "INF_001",
                ErrorMessage: $"Failed to retrieve user rating: {ex.Message}");
        }
    }
}
