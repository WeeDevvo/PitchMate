namespace PitchMate.Api.Tests.Matches;

/// <summary>
/// The squad-scoped match operations: the six Requirement 7.1 names — the ones whose route pattern carried
/// a <c>squadId</c> segment no handler bound, and which now declare it — and the two guest-availability
/// writes and the join and leave writes added since, which bind it from the start.
/// <para>
/// Each member is named exactly as the endpoint's <c>WithName(...)</c> names it, which is what lets
/// <see cref="SquadScopedMatchRoute.DiscoverFrom"/> find each operation's route template on the running
/// host rather than this test restating ten URLs. A renamed endpoint then fails discovery loudly instead
/// of leaving the sweep quietly ranging over nine.
/// </para>
/// </summary>
public enum SquadScopedMatchOperation
{
    /// <summary><c>PUT /squads/{squadId}/matches/{matchId}/availability</c>.</summary>
    SubmitAvailabilityResponse,

    /// <summary><c>DELETE /squads/{squadId}/matches/{matchId}/availability</c>.</summary>
    ClearAvailabilityResponse,

    /// <summary><c>PUT /squads/{squadId}/matches/{matchId}/guest-availability/{membershipId}</c>.</summary>
    SetGuestAvailability,

    /// <summary><c>DELETE /squads/{squadId}/matches/{matchId}/guest-availability/{membershipId}</c>.</summary>
    ClearGuestAvailability,

    /// <summary><c>GET /squads/{squadId}/matches/{matchId}/availability/tally</c> — the one concealing read of the six.</summary>
    GetAvailabilityTally,

    /// <summary><c>POST /squads/{squadId}/matches/{matchId}/confirm</c>.</summary>
    ConfirmMatch,

    /// <summary><c>POST /squads/{squadId}/matches/{matchId}/participants</c>.</summary>
    AddParticipant,

    /// <summary><c>DELETE /squads/{squadId}/matches/{matchId}/participants/{membershipId}</c>.</summary>
    RemoveParticipant,

    /// <summary><c>POST /squads/{squadId}/matches/{matchId}/participants/me</c>.</summary>
    JoinMatch,

    /// <summary><c>DELETE /squads/{squadId}/matches/{matchId}/participants/me</c>.</summary>
    LeaveMatch,
}
