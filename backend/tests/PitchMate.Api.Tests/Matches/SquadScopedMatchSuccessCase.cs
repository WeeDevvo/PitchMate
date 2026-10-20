namespace PitchMate.Api.Tests.Matches;

/// <summary>
/// One operation's success path: a request carrying the match's <em>own</em> squad, sent by a caller that
/// operation's gate admits, against a match in the state that operation requires.
/// <para>
/// Property 18 needs this half as much as it needs the refusal half. Without it the fixture could be one
/// in which every one of the six refuses for some unrelated reason — a wrong state, an ineligible actor —
/// and "the mismatch is refused identically" would hold vacuously over six operations that were never
/// reachable at all. Asserting the success status each operation produces today is what pins the refusal
/// on the squad mismatch, and it is simultaneously the end-to-end evidence that the six are callable with
/// every path parameter of their own route pattern supplied (Requirement 13.17).
/// </para>
/// </summary>
/// <param name="Operation">The operation being driven to success.</param>
/// <param name="MatchId">The match to address, in the state this operation requires.</param>
/// <param name="CallerUserId">A caller this operation's gate admits.</param>
/// <param name="MembershipIdInPath">The value for a <c>membershipId</c> segment, where the template names one.</param>
/// <param name="GuestMembershipIdInBody">The guest to add, where the body carries one.</param>
/// <param name="ExpectedStatus">The success status this operation produces today.</param>
public sealed record SquadScopedMatchSuccessCase(
    SquadScopedMatchOperation Operation,
    Guid MatchId,
    Guid CallerUserId,
    Guid MembershipIdInPath,
    Guid GuestMembershipIdInBody,
    int ExpectedStatus);
