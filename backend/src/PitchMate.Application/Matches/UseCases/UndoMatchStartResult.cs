namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// The outcome of a successful undo of kickoff: the identity of the match, now back in the
/// <c>TeamsRolled</c> state with its teams locked, its kickoff lineup kept and no kickoff instant.
/// </summary>
/// <param name="MatchId">The identity of the match whose kickoff was undone.</param>
public sealed record UndoMatchStartResult(Guid MatchId);
