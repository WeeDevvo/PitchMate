using PitchMate.Domain.Matches;

namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// The outcome of a successful match completion: the completed match's identity, the instant it was
/// completed (the replay ordering key), the fidelity and per-team final scores of the recorded
/// result, and whether the completion was an idempotent no-op on an already-completed match
/// (Requirement 12.1, 12.7).
/// <para>
/// On the first successful completion <see cref="AlreadyCompleted"/> is <see langword="false"/> and
/// the single rating update has been applied. On any subsequent completion request it is
/// <see langword="true"/>: the returned <see cref="Fidelity"/> and <see cref="TeamScores"/> are the
/// originally recorded result and no further rating update was applied (Requirement 12.7, 13.2, 13.5).
/// </para>
/// </summary>
/// <param name="MatchId">The identity of the completed match.</param>
/// <param name="CompletedAt">The instant the match was completed, its stable replay ordering key.</param>
/// <param name="Fidelity">The fidelity at which the recorded result was captured.</param>
/// <param name="TeamScores">The recorded per-team final scores the completion outcome was derived from.</param>
/// <param name="AlreadyCompleted"><see langword="true"/> when this request observed an already-completed match and applied no further rating update.</param>
public sealed record CompleteMatchResult(
    Guid MatchId,
    DateTimeOffset CompletedAt,
    ResultFidelity Fidelity,
    IReadOnlyList<TeamScore> TeamScores,
    bool AlreadyCompleted);
