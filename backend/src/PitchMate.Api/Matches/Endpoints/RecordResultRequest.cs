using PitchMate.Domain.Matches;

namespace PitchMate.Api.Matches.Endpoints;

/// <summary>
/// The body of a record-result request (Requirement 11). A <see cref="ResultFidelity.Basic"/> result
/// is always accepted; a <see cref="ResultFidelity.Rich"/> result is accepted only where the match's
/// squad has live match tracking enabled (Requirement 11.4, 11.5). The <paramref name="TeamScores"/>
/// carry one whole-number final score (0..99) per match team; their range, completeness, and team
/// membership are validated on the <c>Match</c> aggregate, which identifies the offending score and
/// stores nothing on failure (Requirement 11.6, 11.7). The acting admin is resolved from the access
/// token, never from the body.
/// </summary>
/// <param name="Fidelity">The fidelity at which the result is recorded; <c>Rich</c> is gated by the squad's live-tracking feature.</param>
/// <param name="TeamScores">The proposed per-team final scores, one per match team; validated by the aggregate.</param>
public sealed record RecordResultRequest(
    ResultFidelity Fidelity,
    IReadOnlyList<TeamScore>? TeamScores);
