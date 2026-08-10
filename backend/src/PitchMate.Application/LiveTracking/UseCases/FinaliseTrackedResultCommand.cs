namespace PitchMate.Application.LiveTracking.UseCases;

/// <summary>
/// A request by an authenticated admin to finalise a live-tracked match's result while it is in
/// <c>InProgress</c> (Requirement 8.1). The command carries only the target <paramref name="MatchId"/>;
/// the acting user is <strong>never</strong> taken from the request body —
/// <see cref="FinaliseTrackedResultHandler"/> resolves the requester from the authenticated
/// access-token subject via <see cref="Common.ICurrentUserAccessor"/> and authorises it against the
/// match's squad (Requirement 11.1, 11.2).
/// <para>
/// Finalising derives the <c>Rich</c> match result from the running score projected off the match's
/// effective event log — one final score per working team, 0 for a team with no goals (Requirement
/// 8.1, 8.5) — records it on the match, and drives match-lifecycle completion so the single, idempotent
/// rating update stays owned by match-lifecycle (Requirement 8.3). This use case adds no rating logic.
/// </para>
/// </summary>
/// <param name="MatchId">The match whose tracked result is finalised; must be <c>InProgress</c>.</param>
public sealed record FinaliseTrackedResultCommand(Guid MatchId);
