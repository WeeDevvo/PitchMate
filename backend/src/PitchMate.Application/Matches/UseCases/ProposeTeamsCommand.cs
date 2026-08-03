namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// A request by an authenticated organiser to obtain a balanced team proposal for a match
/// (Requirement 8.1). The handler resolves the acting user's membership in the match's squad and
/// permits only an active registered owner or admin (Requirement 14.1, 14.2); it then requires the
/// match to be in <see cref="PitchMate.Domain.Matches.MatchState.Confirmed"/> or
/// <see cref="PitchMate.Domain.Matches.MatchState.TeamsRolled"/> with a participant count between 10
/// and 16 inclusive (Requirement 8.1, 8.9).
/// <para>
/// Producing a proposal is a side-effect-free read: it requests an assignment from the team balancer
/// and returns it to the caller without changing the match state or persisting anything
/// (Requirement 8.1). The admin subsequently applies, adjusts, and locks a proposal through the
/// adjust and lock use cases.
/// </para>
/// </summary>
/// <param name="ActingUserId">The authenticated user requesting the proposal.</param>
/// <param name="MatchId">The match to propose teams for.</param>
public sealed record ProposeTeamsCommand(Guid ActingUserId, Guid MatchId);
