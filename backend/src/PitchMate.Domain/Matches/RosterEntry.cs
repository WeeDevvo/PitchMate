namespace PitchMate.Domain.Matches;

/// <summary>
/// One member of a roster reported by a match read: the squad-membership identity together with the
/// display-name-at-time resolved for it by <see cref="ParticipantDisplayName.Resolve"/>
/// (Requirements 4.5, 10.1).
/// <para>
/// Both the team sheet's roster and the working-teams read's roster carry this one type, so the
/// emitted contract describes one roster shape rather than two. The identity is what lets a roster row
/// link to the player stats screen that names the same membership.
/// </para>
/// </summary>
/// <remarks>
/// A value record, not an entity: it derives from nothing, carries no persistence identity and no
/// audit members, so naming it as the member type of a response contract discloses no persisted row
/// (Requirement 8.8). The shipped precedent is <c>CompleteMatchResult.TeamScores</c>, which is an
/// <c>IReadOnlyList&lt;TeamScore&gt;</c> of this same kind of Domain value.
/// </remarks>
/// <param name="SquadMembershipId">The identity of the squad membership this roster row names.</param>
/// <param name="DisplayName">
/// The display-name-at-time to report for that membership, already resolved through
/// <see cref="ParticipantDisplayName.Resolve"/> and therefore never empty.
/// </param>
public sealed record RosterEntry(Guid SquadMembershipId, string DisplayName);
