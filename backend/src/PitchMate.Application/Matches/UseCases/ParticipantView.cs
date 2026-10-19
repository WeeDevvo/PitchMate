namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// One participant of a match as the match detail read reports it (Requirement 2.3): the
/// squad-membership identity, the display name at time of play, the guest flag and the roster position.
/// It carries <b>no contact detail</b>.
/// <para>
/// <see cref="DisplayName"/> is resolved by <c>ParticipantDisplayName.Resolve</c>, so an anonymised
/// membership reports the placeholder rather than the name captured at addition (Requirement 2.13).
/// <see cref="IsGuest"/> is the flag <b>captured</b> on the participant, not the current membership's:
/// anonymising a registered membership clears its user and role, and reading the membership would
/// silently rewrite that player as a guest.
/// </para>
/// </summary>
/// <param name="SquadMembershipId">The participant's squad-membership identity.</param>
/// <param name="DisplayName">The display name at time of play, or the placeholder for an anonymised membership.</param>
/// <param name="IsGuest">Whether the participant was a guest when added.</param>
/// <param name="RosterPosition">The non-negative position assigned at addition; unique within the match and never reassigned.</param>
public sealed record ParticipantView(
    Guid SquadMembershipId,
    string DisplayName,
    bool IsGuest,
    int RosterPosition);
