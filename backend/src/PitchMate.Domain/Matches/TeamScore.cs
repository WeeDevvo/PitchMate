namespace PitchMate.Domain.Matches;

/// <summary>
/// A single match team's final score within a <see cref="MatchResult"/>: the identity of the
/// <see cref="MatchTeam"/> the score belongs to and that team's whole-number final score
/// (Requirement 11.2, 11.3). Modelled as an immutable value keyed by <see cref="TeamId"/>, so a
/// result carries one <see cref="TeamScore"/> per match team.
/// <para>
/// This type is a plain carrier of a proposed score: it performs no range or membership validation
/// in its constructor. Validation — rejecting a negative or greater-than-99 score, a score for a
/// team that is not one of the match's teams, or a missing score for one of the match's teams — is
/// performed by <see cref="Match.RecordResult(MatchResult, bool)"/> so that the offending score can
/// be identified and reported as a <see cref="MatchErrorCode.ValidationFailed"/> failure rather than
/// thrown (Requirement 11.7). Because <see cref="Score"/> is an <see cref="int"/>, a non-whole score
/// is structurally unrepresentable.
/// </para>
/// </summary>
/// <param name="TeamId">The identity of the <see cref="MatchTeam"/> this score belongs to.</param>
/// <param name="Score">The team's final score; valid values are the whole numbers 0..99 inclusive.</param>
public readonly record struct TeamScore(Guid TeamId, int Score);
