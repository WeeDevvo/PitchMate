using PitchMate.Domain.Matches;

namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// The outcome of a successfully recorded match result: the match's identity and the fidelity the
/// result was recorded at (Requirement 11.2, 11.3). The match remains in
/// <see cref="MatchState.InProgress"/> with its result stored, ready for completion.
/// </summary>
/// <param name="MatchId">The identity of the match whose result was recorded.</param>
/// <param name="Fidelity">The fidelity the recorded result was accepted at.</param>
public sealed record RecordResultResult(Guid MatchId, ResultFidelity Fidelity);
