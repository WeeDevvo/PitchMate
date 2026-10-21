namespace PitchMate.Domain.Matches;

/// <summary>
/// One team's entry on a <see cref="TeamSheet"/>: its <see cref="TeamId"/>, its <see cref="TeamName"/>, its
/// <see cref="BibFlag"/>, and its <see cref="Roster"/> of <see cref="RosterEntry"/> members presented in the
/// team's roster order (Requirement 9.1). Exactly one team on a sheet carries a <see langword="true"/>
/// <see cref="BibFlag"/>, corresponding to the bib-wearing team (Requirement 9.2).
/// </summary>
/// <remarks>
/// This is a pure Domain value with no persistence identity, created only by
/// <see cref="TeamSheet.Project"/> from a match's captured <see cref="KickoffTeam"/>. Its roster is a
/// defensive copy of roster entries — membership identity plus resolved display name — in the
/// order the members appear on the locked team.
/// </remarks>
public sealed class TeamSheetTeam
{
    private readonly List<RosterEntry> _roster;

    /// <summary>
    /// Creates a sheet entry from a locked team's <paramref name="teamId"/>, <paramref name="teamName"/>,
    /// <paramref name="bibFlag"/>, and ordered <paramref name="roster"/> of members.
    /// Called only by <see cref="TeamSheet.Project"/>.
    /// </summary>
    /// <param name="teamId">The identity of the working team this locked team was captured from.</param>
    /// <param name="teamName">The team's locked display name.</param>
    /// <param name="bibFlag"><see langword="true"/> when this is the bib-wearing team.</param>
    /// <param name="roster">The team's members in roster order, each with its resolved display name.</param>
    internal TeamSheetTeam(Guid teamId, string teamName, bool bibFlag, IEnumerable<RosterEntry> roster)
    {
        TeamId = teamId;
        TeamName = teamName;
        BibFlag = bibFlag;
        _roster = [.. roster];
    }

    /// <summary>
    /// The identity of the working <see cref="MatchTeam"/> this locked team was captured from: the key a
    /// recorded result's team scores are given against, so a reader can put each score beside its team.
    /// </summary>
    public Guid TeamId { get; }

    /// <summary>The team's locked display name.</summary>
    public string TeamName { get; }

    /// <summary>Whether this is the match's single bib-wearing team (Requirement 9.2).</summary>
    public bool BibFlag { get; }

    /// <summary>
    /// The team's members in roster order, each identifying its membership so the sheet can link to the
    /// player's stats, with the display-name-at-time (Requirement 9.1; match-read-models Requirement 10.2).
    /// </summary>
    public IReadOnlyList<RosterEntry> Roster => _roster;
}
