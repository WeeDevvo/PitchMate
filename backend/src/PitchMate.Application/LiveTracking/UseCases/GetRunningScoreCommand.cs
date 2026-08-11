namespace PitchMate.Application.LiveTracking.UseCases;

/// <summary>
/// A request by an authenticated squad member to read a live-tracked match's current running score,
/// projected from the match's effective event log at request time (Requirement 6.1, 13.3). The command
/// carries only the target <paramref name="MatchId"/>; the acting user is <strong>never</strong> taken
/// from the request body or query — <see cref="GetRunningScoreHandler"/> resolves the requester from the
/// authenticated access-token subject via <see cref="Common.ICurrentUserAccessor"/> and authorises it as
/// an active member of the match's squad (Requirement 11.3, 11.4).
/// <para>
/// This is a pure read: it broadcasts nothing and mutates nothing, deriving each team's tally from the
/// set of effective events via the Domain projection so the answer is order-independent and reflects any
/// retractions in force at request time (Requirement 6.1, 13.3).
/// </para>
/// </summary>
/// <param name="MatchId">The match whose current running score is read.</param>
public sealed record GetRunningScoreCommand(Guid MatchId);
