namespace PitchMate.Domain.Matches;

/// <summary>
/// A lightweight identity-plus-name view of an active squad membership, registered or guest,
/// supplied to <see cref="Match.Confirm"/> so the aggregate can seed participants without reaching
/// into the squads-and-membership aggregate.
/// <para>
/// Scoping a candidate set to <em>active</em> memberships is the Application layer's concern
/// (mirroring how the availability tally leaves eligibility to the caller); the caller passes
/// exactly those members, and the <see cref="Match"/> aggregate selects from them the ones whose
/// stored availability response marks the confirmed day. A guest's response is one an admin marked
/// for it. The <see cref="DisplayName"/> is captured onto the seeded <see cref="MatchParticipant"/>
/// as its display-name-at-time, and <see cref="IsGuest"/> becomes the participant's guest flag.
/// </para>
/// </summary>
/// <param name="SquadMembershipId">The identity of the active squad membership.</param>
/// <param name="DisplayName">The membership's current display name, captured onto a seeded participant.</param>
/// <param name="IsGuest">Whether the membership is a guest, carried onto a seeded participant.</param>
public readonly record struct ConfirmableMember(Guid SquadMembershipId, string DisplayName, bool IsGuest);
