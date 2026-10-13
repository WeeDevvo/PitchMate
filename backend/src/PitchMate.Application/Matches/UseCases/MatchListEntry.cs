using PitchMate.Domain.Matches;

namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// One match of a squad as the match list read reports it: the match's identity, its lifecycle state,
/// its location verbatim as the match aggregate holds it, its scheduling days, its participant count,
/// the names and bib flags of its locked teams, and its recorded result and completion instant
/// (Requirements 1.4, 1.5, 1.6, 1.7).
/// <para>
/// <b>Every state-dependent member is a declared member of the schema, never omitted</b>
/// (Requirement 1.8). An absent single value — <see cref="ConfirmedDay"/>,
/// <see cref="RecordedResult"/>, <see cref="CompletedAt"/> — is an explicit <see langword="null"/>,
/// and an absent collection — <see cref="CandidateDays"/>, <see cref="LockedTeams"/> — is an
/// <b>empty</b> collection. That is what stops an entry for a <c>Completed</c> match and an entry for
/// a <c>GatheringAvailability</c> match being two different TypeScript shapes: a client writes one
/// reader for the row, not one per state. Because the reference-typed members are non-nullable the
/// exporter emits them <c>required</c>.
/// </para>
/// <para>
/// <see cref="State"/> is a <b>non-nullable</b> <see cref="MatchState"/>, which keeps
/// <see langword="null"/> out of the shared emitted enum array (Requirement 9.6):
/// <c>MembershipState</c>'s <c>{"enum":["Active","Inactive",null]}</c> is the counter-example to
/// avoid, where a nullable reference site made the exporter fold a <c>null</c> into the shared schema.
/// </para>
/// <para>
/// It derives from no persistence base type and names no Domain <b>entity</b> type, so no
/// <c>BaseEntity</c>-declared audit or soft-delete member crosses the wire (Requirements 8.8, 11.1).
/// The Domain types it does name — <see cref="MatchState"/> through this contract and
/// <see cref="ResultFidelity"/> and <see cref="TeamScore"/> through
/// <see cref="RecordedResultView"/> — are identity-less values, the precedent
/// <see cref="CompleteMatchResult"/> already ships.
/// </para>
/// </summary>
/// <param name="MatchId">The identity of the match.</param>
/// <param name="State">The match's lifecycle state; never absent, so the emitted enum carries the member names alone.</param>
/// <param name="Location">The match's location, verbatim as the match aggregate holds it.</param>
/// <param name="ConfirmedDay">The confirmed day as a bare UTC instant where the match has one; otherwise an explicit <see langword="null"/>.</param>
/// <param name="CandidateDays">The match's 1-to-14 candidate days as bare UTC instants while it is gathering availability; otherwise empty, never omitted.</param>
/// <param name="ParticipantCount">The number of the match's participants, counting guest and registered participants alike.</param>
/// <param name="LockedTeams">The locked teams' names and bib flags in locked-team order; empty where no kickoff lineup is locked. Carries no roster and no membership identity.</param>
/// <param name="RecordedResult">The recorded result where the match is completed; otherwise an explicit <see langword="null"/>.</param>
/// <param name="CompletedAt">The completion instant where the match is completed; otherwise an explicit <see langword="null"/>.</param>
public sealed record MatchListEntry(
    Guid MatchId,
    MatchState State,
    string Location,
    DateTimeOffset? ConfirmedDay,
    IReadOnlyList<DateTimeOffset> CandidateDays,
    int ParticipantCount,
    IReadOnlyList<LockedTeamSummary> LockedTeams,
    RecordedResultView? RecordedResult,
    DateTimeOffset? CompletedAt);
