namespace PitchMate.Api.Tests.Matches;

/// <summary>
/// The identities of the world <see cref="SquadMismatchApiFixture"/> seeds into the container-backed
/// database once, before any request is sent.
/// <para>
/// Two squads exist because a mismatch needs a second squad that is genuinely real — and because the
/// sharp case needs a caller who <em>owns</em> the squad the path names while holding no membership of the
/// match's squad. Four matches exist because the six operations do not share one lifecycle state: the
/// probe match is the one every refusal is measured against, and each success assertion needs a match in
/// the state its own operation requires, kept apart so one success cannot disturb another.
/// </para>
/// </summary>
/// <param name="MatchSquadId">The squad every seeded match belongs to.</param>
/// <param name="OtherSquadId">A second real squad, never the owner of any seeded match.</param>
/// <param name="OrganiserUserId">An active <c>Owner</c> of <paramref name="MatchSquadId"/>.</param>
/// <param name="OtherSquadOwnerUserId">An active <c>Owner</c> of <paramref name="OtherSquadId"/> holding no membership of <paramref name="MatchSquadId"/>.</param>
/// <param name="StrangerUserId">A registered user holding no membership in any squad.</param>
/// <param name="MemberUserId">An active registered plain member of <paramref name="MatchSquadId"/>.</param>
/// <param name="ProbeMatchId">The <c>Confirmed</c> match every refusal and every baseline is measured against.</param>
/// <param name="ProbeParticipantMembershipId">A membership that is genuinely a participant of the probe match.</param>
/// <param name="ProbeGuestMembershipId">An active guest of the match's squad, not a participant of the probe match.</param>
/// <param name="GatheringMatchId">A <c>GatheringAvailability</c> match for the availability operations' success paths.</param>
/// <param name="ConfirmableMatchId">A <c>GatheringAvailability</c> match whose stored responses meet the confirmation threshold.</param>
/// <param name="ParticipantMatchId">A <c>Confirmed</c> match with seeded participants for the participant operations' success paths.</param>
/// <param name="AddableGuestMembershipId">An active guest of the match's squad, not a participant of the participant match.</param>
/// <param name="RemovableParticipantMembershipId">A membership that is a participant of the participant match.</param>
/// <param name="JoinerUserId">An active registered member who marked no day, so is in no match until they join.</param>
/// <param name="CandidateDay">A genuine candidate day of every seeded match, as request bodies send it.</param>
public sealed record SeededSquadMismatchWorld(
    Guid MatchSquadId,
    Guid OtherSquadId,
    Guid OrganiserUserId,
    Guid OtherSquadOwnerUserId,
    Guid StrangerUserId,
    Guid MemberUserId,
    Guid ProbeMatchId,
    Guid ProbeParticipantMembershipId,
    Guid ProbeGuestMembershipId,
    Guid GatheringMatchId,
    Guid ConfirmableMatchId,
    Guid ParticipantMatchId,
    Guid AddableGuestMembershipId,
    Guid RemovableParticipantMembershipId,
    Guid JoinerUserId,
    DateTimeOffset CandidateDay);
