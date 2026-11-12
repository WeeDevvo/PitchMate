namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// Clears the availability an owner or admin marked for a guest, so the guest has no stored response.
/// </summary>
/// <param name="ActingUserId">The authenticated user acting; must be an active owner or admin of the match's squad.</param>
/// <param name="SquadId">The squad named in the request path; must be the match's own squad.</param>
/// <param name="MatchId">The match gathering availability.</param>
/// <param name="GuestMembershipId">The guest membership whose response is cleared; must be an active guest of the match's squad.</param>
public sealed record ClearGuestAvailabilityCommand(
    Guid ActingUserId,
    Guid SquadId,
    Guid MatchId,
    Guid GuestMembershipId);
