namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// The identity produced by a successful match cancellation: the cancelled match's GUID v7 identity.
/// The match's record is retained for audit and excluded from the rating-engine replay sequence
/// (Requirement 15.1, 15.5).
/// </summary>
/// <param name="MatchId">The identity of the cancelled match.</param>
public sealed record CancelMatchResult(Guid MatchId);
