namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// A request by an authenticated user to read one match as a <see cref="MatchDetail"/>
/// (Requirement 2.1). The detail is returned only when the requester holds an active membership in the
/// <b>match's</b> squad; any other requester — and a match that is absent, soft-deleted or in a squad
/// within its deletion grace period — receives the single uniform authorisation failure
/// (Requirements 5.1, 5.10, 5.13).
/// <para>
/// The command names no squad: the URL names only the match, and the squad is resolved from the match
/// itself, so a caller cannot choose whose availability is reported (Requirement 3.1).
/// </para>
/// </summary>
/// <param name="RequestingUserId">The authenticated user requesting the match.</param>
/// <param name="MatchId">The match named in the request path.</param>
public sealed record GetMatchDetailCommand(Guid RequestingUserId, Guid MatchId);
