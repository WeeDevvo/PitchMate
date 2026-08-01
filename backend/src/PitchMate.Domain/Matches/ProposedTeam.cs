namespace PitchMate.Domain.Matches;

/// <summary>
/// A single team within a team-rolling proposal handed to <see cref="Match.ApplyTeamProposal"/>: a
/// <see cref="TeamName"/>, a <see cref="BibFlag"/>, and the ordered squad-membership identities
/// assigned to the team. The proposal as a whole must partition the match's participants exactly —
/// every participant on exactly one team, none unassigned, none duplicated (Requirement 8.2).
/// <para>
/// This is a lightweight transport value carrying an admin- or balancer-produced assignment into the
/// aggregate; the aggregate validates the partition and materialises <see cref="MatchTeam"/> working
/// teams from it. Team-name length, team-size, and bib-flag rules are enforced later at
/// <see cref="Match.Lock"/> (Requirement 8.5, 8.7), not on application.
/// </para>
/// </summary>
/// <param name="TeamName">The proposed team display name; trimming and validation are applied at lock.</param>
/// <param name="BibFlag"><see langword="true"/> when this team is proposed to wear bibs.</param>
/// <param name="ParticipantMembershipIds">The ordered squad-membership identities assigned to this team.</param>
public sealed record ProposedTeam(
    string TeamName,
    bool BibFlag,
    IReadOnlyList<Guid> ParticipantMembershipIds);
