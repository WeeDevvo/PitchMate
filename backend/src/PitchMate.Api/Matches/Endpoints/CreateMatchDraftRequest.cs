namespace PitchMate.Api.Matches.Endpoints;

/// <summary>
/// The body of a create-match-draft request (Requirement 1). The <paramref name="Location"/> (trimmed
/// 1..200 characters) and <paramref name="CandidateDays"/> (1..14 distinct, strictly-future days) are
/// validated on the <c>Match</c> aggregate; both are accepted as supplied. The optional
/// <paramref name="MatchId"/> is a client-generated GUID v7 identity retained for idempotent creation,
/// so a retry from a flaky client carries the same id; a fresh GUID v7 is generated when it is omitted
/// (Requirement 13.1). The creating admin is resolved from the access token, never from the body.
/// </summary>
/// <param name="Location">The requested match location; trimmed and validated by the aggregate.</param>
/// <param name="CandidateDays">The proposed candidate days; must be 1..14, distinct, and strictly future.</param>
/// <param name="MatchId">An optional client-supplied GUID v7 identity, or <see langword="null"/> to generate one.</param>
public sealed record CreateMatchDraftRequest(
    string? Location,
    IReadOnlyList<DateTimeOffset>? CandidateDays,
    Guid? MatchId);
