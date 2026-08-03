namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// The identity produced by a successful match-draft creation: the created match's GUID v7 identity,
/// which equals the client-supplied id when one was provided and a freshly generated GUID v7 otherwise
/// (Requirement 1.1, 13.1).
/// </summary>
/// <param name="MatchId">The identity of the created match draft.</param>
public sealed record CreateMatchDraftResult(Guid MatchId);
