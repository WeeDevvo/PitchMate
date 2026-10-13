namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// The declared response contract of <c>PUT /squads/{squadId}/matches/{matchId}/availability</c>: the
/// match the response was submitted against, the responding squad membership, the submission instant,
/// and the marked candidate days (Requirement 8.1).
/// <para>
/// It exists so the operation stops returning the <see cref="PitchMate.Domain.Matches.AvailabilityResponse"/>
/// <b>persistence entity</b>, whose <c>BaseEntity</c>-declared members — the entity identity, the
/// creation and update instants, the creating and updating actors, and the soft-delete flag and
/// instant — cross the wire today for no consumer's benefit (Requirement 8.3). It derives from no
/// persistence base type and names none, carrying exactly the four values above.
/// </para>
/// <para>
/// It deliberately carries <b>no squad identity</b>: <c>squadId</c> is a declared path parameter of
/// the request, so the caller already holds it and the response need not repeat it (Requirement 8.1).
/// Every instant is a bare UTC <see cref="DateTimeOffset"/> rather than a wrapped
/// <see cref="PitchMate.Domain.Matches.CandidateDay"/>, so a marked day shares the one wire shape
/// every other match read uses for an instant (Requirements 9.1, 9.2).
/// </para>
/// <para>
/// The values reported are exactly those the operation reports today — the stored response's own
/// submission instant and marked days, in the order the aggregate holds them — so the change removes
/// members and alters no value a consumer already reads (Requirement 8.4). Where the submission
/// replaces a response already stored for the membership, the reported instant and marked days are
/// the <b>replacing</b> submission's, because the aggregate discards the replaced response before
/// producing the one projected here (Requirement 8.2).
/// </para>
/// </summary>
/// <param name="MatchId">The identity of the match the response was submitted against.</param>
/// <param name="SquadMembershipId">The identity of the responding squad membership.</param>
/// <param name="SubmittedAt">The instant the reported submission was made.</param>
/// <param name="MarkedDays">The candidate days the submission marks as available, each a bare UTC instant; may be empty.</param>
public sealed record SubmitAvailabilityResult(
    Guid MatchId,
    Guid SquadMembershipId,
    DateTimeOffset SubmittedAt,
    IReadOnlyList<DateTimeOffset> MarkedDays);
