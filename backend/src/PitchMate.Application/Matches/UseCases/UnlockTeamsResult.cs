namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// The outcome of a successful unlock: the identity of the match, now back in the <c>Confirmed</c>
/// state with its working teams kept and no kickoff lineup captured.
/// </summary>
/// <param name="MatchId">The identity of the match whose teams were unlocked.</param>
public sealed record UnlockTeamsResult(Guid MatchId);
