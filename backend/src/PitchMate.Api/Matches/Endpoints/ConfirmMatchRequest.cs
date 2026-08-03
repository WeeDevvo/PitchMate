namespace PitchMate.Api.Matches.Endpoints;

/// <summary>
/// The body of a confirm-match request (Requirement 6.1). The <paramref name="Day"/> must resolve, by
/// instant, to one of the match's candidate days, and that day's count of available active registered
/// members must meet the squad's minimum threshold; both are validated on the <c>Match</c> aggregate.
/// The confirming admin is resolved from the access token, never from the body.
/// </summary>
/// <param name="Day">The candidate day to confirm on; must resolve, by instant, to one of the match's candidate days.</param>
public sealed record ConfirmMatchRequest(DateTimeOffset Day);
