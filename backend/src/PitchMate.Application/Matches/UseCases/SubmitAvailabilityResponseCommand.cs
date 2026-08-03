namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// A request by an authenticated user to submit or replace their availability response for a match
/// while it is gathering availability (Requirement 4.1, 4.2). The <paramref name="MarkedDays"/> are
/// the candidate days on which the member declares availability; each must be one of the match's
/// candidate days, and the set may be empty to record availability on none of the days — a stored
/// empty-subset response that is distinct from having no stored response (Requirement 4.4, 4.7).
/// <para>
/// The acting user is resolved from the authenticated subject, never a body value, and must be an
/// active registered member of the match's squad; a guest, inactive, or non-member is rejected with a
/// uniform authorisation failure and no response is stored (Requirement 4.5, 7.6).
/// </para>
/// </summary>
/// <param name="ActingUserId">The authenticated user submitting the response.</param>
/// <param name="MatchId">The match the response is submitted against.</param>
/// <param name="MarkedDays">The candidate days marked as available; each must be a candidate day. May be empty.</param>
public sealed record SubmitAvailabilityResponseCommand(
    Guid ActingUserId,
    Guid MatchId,
    IReadOnlyList<DateTimeOffset> MarkedDays);
