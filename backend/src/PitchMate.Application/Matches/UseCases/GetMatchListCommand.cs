namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// A request by an authenticated user to read a squad's matches as a bounded, ordered
/// <see cref="MatchList"/> (Requirement 1.1). The list is returned only when the requester holds an
/// active membership in the named squad; any other requester — a membership that is not
/// <c>Active</c>, a non-member, a squad that does not exist, or a squad within its deletion grace
/// period — receives the single uniform authorisation failure, so a refusal discloses neither the
/// squad's existence nor the caller's membership state (Requirement 5.1, 5.9, 5.13).
/// <para>
/// Unlike the match-scoped reads, this read's URL names the <em>squad</em> rather than a match, so
/// <see cref="SquadId"/> is both the read's subject and the squad the acting membership is resolved
/// in — there is no match from which to derive a squad, and therefore no squad-mismatch case to
/// refuse (Requirement 7.6).
/// </para>
/// </summary>
/// <param name="RequestingUserId">The authenticated user requesting the squad's match list.</param>
/// <param name="SquadId">The squad named in the request path, whose matches are listed.</param>
public sealed record GetMatchListCommand(Guid RequestingUserId, Guid SquadId);
