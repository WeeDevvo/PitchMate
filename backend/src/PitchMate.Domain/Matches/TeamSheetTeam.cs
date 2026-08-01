namespace PitchMate.Domain.Matches;

/// <summary>
/// One team's entry on a <see cref="TeamSheet"/>: its <see cref="TeamName"/>, its
/// <see cref="BibFlag"/>, and its <see cref="Roster"/> of participant display names presented in the
/// team's roster order (Requirement 9.1). Exactly one team on a sheet carries a <see langword="true"/>
/// <see cref="BibFlag"/>, corresponding to the bib-wearing team (Requirement 9.2).
/// </summary>
/// <remarks>
/// This is a pure Domain value with no persistence identity, created only by
/// <see cref="TeamSheet.Project"/> from a match's captured <see cref="KickoffTeam"/>. Its roster is a
/// defensive copy of display names resolved from the match's participants at projection time, in the
/// order the members appear on the locked team.
/// </remarks>
public sealed class TeamSheetTeam
{
    private readonly List<string> _roster;

    /// <summary>
    /// Creates a sheet entry from a locked team's <paramref name="teamName"/>,
    /// <paramref name="bibFlag"/>, and ordered <paramref name="roster"/> of participant display names.
    /// Called only by <see cref="TeamSheet.Project"/>.
    /// </summary>
    /// <param name="teamName">The team's locked display name.</param>
    /// <param name="bibFlag"><see langword="true"/> when this is the bib-wearing team.</param>
    /// <param name="roster">The participant display names in the team's roster order.</param>
    internal TeamSheetTeam(string teamName, bool bibFlag, IEnumerable<string> roster)
    {
        TeamName = teamName;
        BibFlag = bibFlag;
        _roster = [.. roster];
    }

    /// <summary>The team's locked display name.</summary>
    public string TeamName { get; }

    /// <summary>Whether this is the match's single bib-wearing team (Requirement 9.2).</summary>
    public bool BibFlag { get; }

    /// <summary>The team's roster of participant display names, in the team's roster order (Requirement 9.1).</summary>
    public IReadOnlyList<string> Roster => _roster;
}
