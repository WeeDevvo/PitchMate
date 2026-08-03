namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// A request by an authenticated user to clear their own availability response for a match while it
/// is gathering availability, reverting the member to having no stored response (Requirement 4.3).
/// Clearing when the member has no stored response is a success that changes nothing.
/// <para>
/// The acting user is resolved from the authenticated subject, never a body value, and must be an
/// active registered member of the match's squad; a guest, inactive, or non-member is rejected with a
/// uniform authorisation failure and nothing is changed (Requirement 4.5, 7.6).
/// </para>
/// </summary>
/// <param name="ActingUserId">The authenticated user clearing their response.</param>
/// <param name="MatchId">The match whose response is cleared.</param>
public sealed record ClearAvailabilityResponseCommand(
    Guid ActingUserId,
    Guid MatchId);
