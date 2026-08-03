namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// The outcome of a successful start: the identity of the match now in the <c>InProgress</c> state,
/// retaining the immutable kickoff lineup captured at team lock (Requirement 11.1).
/// </summary>
/// <param name="MatchId">The identity of the match that was transitioned into play.</param>
public sealed record StartMatchResult(Guid MatchId);
