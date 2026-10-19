namespace PitchMate.Infrastructure.Matches.Queries;

/// <summary>
/// One row of <see cref="EfWorkingTeamsSource"/>'s first statement: the match header, repeated, and at
/// most one team. A match with no team yields one row whose team columns are all <see langword="null"/>.
/// </summary>
internal sealed class WorkingTeamRow
{
    public Guid MatchId { get; set; }

    public Guid SquadId { get; set; }

    public Guid? TeamId { get; set; }

    public string? TeamName { get; set; }

    public bool? BibFlag { get; set; }

    public Guid[]? Roster { get; set; }
}

/// <summary>One participant of the match with its display name resolved by the SQL form of the rule.</summary>
internal sealed class WorkingTeamsParticipantRow
{
    public Guid SquadMembershipId { get; set; }

    public string DisplayName { get; set; } = string.Empty;
}

/// <summary>One participating squad member's skill tier and persisted rating, if it has one.</summary>
internal sealed class WorkingTeamsRatingRow
{
    public Guid SquadMembershipId { get; set; }

    public int? SkillTier { get; set; }

    public double? Mu { get; set; }

    public double? Sigma { get; set; }
}
