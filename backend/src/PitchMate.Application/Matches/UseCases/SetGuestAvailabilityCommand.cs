namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// Marks the candidate days a guest can play, on the guest's behalf. Guests have no account, so an
/// owner or admin answers for them; the response counts towards confirmation like any other.
/// </summary>
/// <param name="ActingUserId">The authenticated user acting; must be an active owner or admin of the match's squad.</param>
/// <param name="SquadId">The squad named in the request path; must be the match's own squad.</param>
/// <param name="MatchId">The match gathering availability.</param>
/// <param name="GuestMembershipId">The guest membership the response is for; must be an active guest of the match's squad.</param>
/// <param name="MarkedDays">The candidate days the guest can play. May be empty.</param>
public sealed record SetGuestAvailabilityCommand(
    Guid ActingUserId,
    Guid SquadId,
    Guid MatchId,
    Guid GuestMembershipId,
    IReadOnlyList<DateTimeOffset> MarkedDays);
