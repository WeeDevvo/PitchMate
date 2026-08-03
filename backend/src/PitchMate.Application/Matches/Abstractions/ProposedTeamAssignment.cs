namespace PitchMate.Application.Matches.Abstractions;

/// <summary>
/// A single team within a <see cref="TeamProposal"/>: the ordered squad-membership identities the
/// balancer assigned to the team, plus the team's predicted win probability. The proposal as a whole
/// partitions the offered participants exactly — every participant on exactly one team, none
/// unassigned, none duplicated (Requirement 8.2). Team names and bib flags are not part of the
/// balancing assignment; they are set by the admin before locking (Requirement 8.3, 8.4).
/// </summary>
/// <param name="ParticipantMembershipIds">The ordered squad-membership identities assigned to this team.</param>
/// <param name="WinProbability">The team's predicted win probability from <see cref="Domain.Rating.IRatingEngine.Predict"/>, in [0, 1].</param>
public sealed record ProposedTeamAssignment(
    IReadOnlyList<Guid> ParticipantMembershipIds,
    double WinProbability);
