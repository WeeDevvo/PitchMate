namespace PitchMate.Api.Matches.Endpoints;

/// <summary>
/// The body of a submit-availability request (Requirement 4.1, 4.2). The <paramref name="MarkedDays"/>
/// are the candidate days on which the acting member declares availability; each must be one of the
/// match's candidate days, validated on the <c>Match</c> aggregate. The set may be empty to record
/// availability on none of the days — a stored empty-subset response distinct from having none
/// (Requirement 4.7). The acting member is resolved from the access token, never from the body.
/// </summary>
/// <param name="MarkedDays">The candidate days marked as available; each must be a candidate day. May be empty.</param>
public sealed record SubmitAvailabilityRequest(IReadOnlyList<DateTimeOffset>? MarkedDays);
