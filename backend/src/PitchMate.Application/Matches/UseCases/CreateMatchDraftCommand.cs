namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// A request by an authenticated user to create a match draft for a squad they organise
/// (Requirement 1.1). The handler resolves the acting user's membership in
/// <paramref name="SquadId"/> and permits only an active registered owner or admin (Requirement 1.2).
/// The <paramref name="Location"/> (trimmed 1..200 characters) and <paramref name="CandidateDays"/>
/// (1..14 distinct, strictly-future days) are validated on the <c>Match</c> aggregate; malformed
/// input is reported as a validation failure rather than throwing, so both are accepted as supplied
/// (Requirement 1.3, 1.4, 1.5, 1.6).
/// <para>
/// <paramref name="MatchId"/> is an optional client-supplied GUID v7 identity retained for idempotent
/// creation: when supplied and non-empty it becomes the created match's identity so a retry from a
/// flaky client carries the same id; when <see langword="null"/> or <see cref="Guid.Empty"/> a fresh
/// GUID v7 is generated (Requirement 13.1).
/// </para>
/// </summary>
/// <param name="ActingUserId">The authenticated user requesting the draft.</param>
/// <param name="SquadId">The squad the match is drafted for.</param>
/// <param name="Location">The requested match location; trimmed and validated by the aggregate.</param>
/// <param name="CandidateDays">The proposed candidate days; must be 1..14, distinct, and strictly future.</param>
/// <param name="MatchId">An optional client-supplied GUID v7 identity, or <see langword="null"/> to generate one.</param>
public sealed record CreateMatchDraftCommand(
    Guid ActingUserId,
    Guid SquadId,
    string Location,
    IReadOnlyList<DateTimeOffset> CandidateDays,
    Guid? MatchId = null);
