namespace PitchMate.Infrastructure.Matches.Queries;

/// <summary>
/// One row of <see cref="EfMatchDetailSource"/>'s statement: the match header, repeated, and at most one
/// participant. A match with no participants yields exactly one row whose participant columns are all
/// <see langword="null"/>.
/// </summary>
internal sealed class MatchDetailRow
{
    public Guid MatchId { get; set; }

    public Guid SquadId { get; set; }

    public int State { get; set; }

    public string Location { get; set; } = string.Empty;

    public DateTimeOffset? ConfirmedDay { get; set; }

    public DateTimeOffset? CompletedAt { get; set; }

    public string CandidateDaysJson { get; set; } = string.Empty;

    public string? RecordedResultJson { get; set; }

    public Guid? ParticipantMembershipId { get; set; }

    public string? ParticipantDisplayName { get; set; }

    public bool? ParticipantIsGuest { get; set; }

    public int? ParticipantRosterPosition { get; set; }
}
