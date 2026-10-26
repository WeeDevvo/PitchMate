using PitchMate.Domain.Matches;

namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// One match as the match detail read reports it: its identity and owning squad, its lifecycle state,
/// location, candidate and confirmed days, its playing pool, whether the caller is in it, the
/// caller's own availability, and its recorded result and completion instant (Requirements 2.2–2.7, 3.2).
/// <para>
/// <see cref="SquadId"/> is resolved from the identified match, never from the request: this is the one
/// match read whose URL names no squad (Requirement 2.2). <see cref="CandidateDays"/> is carried in
/// <b>every</b> state, unlike the list entry's, because a reloaded page needs the days a match was
/// offered on after it has confirmed one.
/// </para>
/// <para>
/// <b>Every state-dependent member is declared in every state</b> (Requirement 2.6): an absent
/// <see cref="ConfirmedDay"/>, <see cref="RecordedResult"/> or <see cref="CompletedAt"/> is an explicit
/// <see langword="null"/>, never omitted and never a placeholder. <see cref="State"/> is a non-nullable
/// <see cref="MatchState"/> so the shared enum schema carries no <c>null</c> (Requirement 9.6).
/// </para>
/// <para>
/// It derives from no persistence base type and names no Domain entity type, so no audit or
/// soft-delete member crosses the wire (Requirements 8.8, 11.1).
/// </para>
/// </summary>
/// <param name="MatchId">The identity of the match.</param>
/// <param name="SquadId">The owning squad, resolved from the match itself.</param>
/// <param name="State">The match's lifecycle state.</param>
/// <param name="Location">The match's location, verbatim as the match aggregate holds it.</param>
/// <param name="CandidateDays">The match's 1-to-14 candidate days as bare UTC instants, in every state.</param>
/// <param name="ConfirmedDay">The confirmed day as a bare UTC instant where the match has one; otherwise an explicit <see langword="null"/>.</param>
/// <param name="ParticipantCount">The number of <see cref="Participants"/> carried, guests and registered members alike.</param>
/// <param name="Participants">One view per participant, in ascending roster-position order, with no maximum and no truncation.</param>
/// <param name="CallerIsParticipant">Whether the calling member is one of the <see cref="Participants"/>, so they can join or leave.</param>
/// <param name="CallerAvailability">The calling member's own stored availability response, present on every detail.</param>
/// <param name="RecordedResult">The recorded result where the match has one; otherwise an explicit <see langword="null"/>.</param>
/// <param name="CompletedAt">The completion instant for a <c>Completed</c> match; otherwise an explicit <see langword="null"/>.</param>
/// <param name="GuestAvailability">
/// The stored availability responses of the squad's active guests, which an owner or admin marks on
/// their behalf. Present on every detail: filled for an owner or admin while the match is gathering
/// availability, and empty otherwise, so the read's audience and window match the write's.
/// </param>
public sealed record MatchDetail(
    Guid MatchId,
    Guid SquadId,
    MatchState State,
    string Location,
    IReadOnlyList<DateTimeOffset> CandidateDays,
    DateTimeOffset? ConfirmedDay,
    int ParticipantCount,
    IReadOnlyList<ParticipantView> Participants,
    bool CallerIsParticipant,
    CallerAvailability CallerAvailability,
    RecordedResultView? RecordedResult,
    DateTimeOffset? CompletedAt,
    IReadOnlyList<GuestAvailabilityView> GuestAvailability);
