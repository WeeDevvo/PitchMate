namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// One guest's stored availability response, as an owner or admin marked it, reported on the match
/// detail so the organiser can see and change what was marked.
/// </summary>
/// <param name="SquadMembershipId">The guest membership the response is for.</param>
/// <param name="MarkedDays">The candidate days marked for the guest, as bare UTC instants. May be empty.</param>
public sealed record GuestAvailabilityView(
    Guid SquadMembershipId,
    IReadOnlyList<DateTimeOffset> MarkedDays);
