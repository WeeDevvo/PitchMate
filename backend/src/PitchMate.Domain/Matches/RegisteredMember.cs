namespace PitchMate.Domain.Matches;

/// <summary>
/// A lightweight identity-plus-name view of an active registered squad membership, supplied to
/// <see cref="Match.Confirm"/> so the aggregate can seed registered participants without reaching
/// into the squads-and-membership aggregate.
/// <para>
/// Scoping a candidate set to <em>active registered</em> memberships is the Application layer's
/// concern (mirroring how the availability tally leaves eligibility to the caller); the caller
/// passes exactly those members, and the <see cref="Match"/> aggregate selects from them the ones
/// whose stored availability response marks the confirmed day (Requirement 6.5). The
/// <see cref="DisplayName"/> is captured onto the seeded <see cref="MatchParticipant"/> as its
/// display-name-at-time.
/// </para>
/// </summary>
/// <param name="SquadMembershipId">The identity of the active registered squad membership.</param>
/// <param name="DisplayName">The membership's current display name, captured onto a seeded participant.</param>
public readonly record struct RegisteredMember(Guid SquadMembershipId, string DisplayName);
