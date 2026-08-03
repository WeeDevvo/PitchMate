namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// The outcome of a successful team lock: the identity of the match whose teams were locked, now in
/// the <c>TeamsRolled</c> state with an immutable kickoff lineup captured from the locked teams
/// (Requirement 8.7, 9.3, 10.1).
/// </summary>
/// <param name="MatchId">The identity of the match whose teams were locked.</param>
public sealed record LockTeamsResult(Guid MatchId);
