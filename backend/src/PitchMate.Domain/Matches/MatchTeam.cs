using PitchMate.Domain.Common;

namespace PitchMate.Domain.Matches;

/// <summary>
/// One working side within a <see cref="Match"/> while teams are being rolled: a
/// <see cref="TeamName"/>, a <see cref="BibFlag"/>, and an ordered roster of the squad-membership
/// identities assigned to the team (Requirement 8). A match carries two or more match teams once a
/// proposal has been applied; the MVP UI uses two. Together the teams partition the match's
/// participants exactly — every participant sits on exactly one team, with none unassigned and none
/// duplicated — an invariant the owning <see cref="Match"/> aggregate maintains across proposal
/// application and participant moves (Requirement 8.2, 8.3).
/// <para>
/// Deriving from <see cref="BaseEntity"/> supplies the GUID v7 key, audit fields, and soft-delete
/// state. The type uses only the .NET base class library and existing Domain types, keeping Domain
/// free of framework concerns (Requirement 16.1). Instances are created and mutated only by the
/// owning <see cref="Match"/> aggregate through its team-editing behaviour; the mutators are
/// deliberately <see langword="internal"/> so the partition invariant cannot be broken from outside.
/// </para>
/// </summary>
public sealed class MatchTeam : BaseEntity
{
    private readonly List<Guid> _roster = [];

    /// <summary>Parameterless constructor reserved for the persistence layer.</summary>
    private MatchTeam()
    {
        TeamName = string.Empty;
    }

    /// <summary>
    /// Creates a working team for <paramref name="matchId"/> with the supplied
    /// <paramref name="teamName"/>, <paramref name="bibFlag"/>, and ordered
    /// <paramref name="roster"/> of participant squad-membership identities. Called only by the
    /// owning <see cref="Match"/> aggregate when a team proposal is applied.
    /// </summary>
    /// <param name="matchId">The identity of the match this team belongs to.</param>
    /// <param name="teamName">The team's display name as supplied; trimming and validation are applied at lock.</param>
    /// <param name="bibFlag"><see langword="true"/> when this team is marked to wear bibs for the match.</param>
    /// <param name="roster">The ordered squad-membership identities assigned to this team.</param>
    internal MatchTeam(Guid matchId, string teamName, bool bibFlag, IEnumerable<Guid> roster)
    {
        MatchId = matchId;
        TeamName = teamName;
        BibFlag = bibFlag;
        _roster.AddRange(roster);
    }

    /// <summary>The identity of the match this team belongs to.</summary>
    public Guid MatchId { get; private set; }

    /// <summary>The team's display name. Its trimmed length must be 1..50 characters at lock (Requirement 8.5, 8.7).</summary>
    public string TeamName { get; private set; }

    /// <summary>
    /// Whether this team is marked to wear bibs for the match. Exactly one team per match must carry a
    /// <see langword="true"/> flag at lock (Requirement 8.5, 8.7).
    /// </summary>
    public bool BibFlag { get; private set; }

    /// <summary>
    /// The ordered squad-membership identities assigned to this team. Its size must be 5..8 at lock,
    /// with uneven team sizes permitted (Requirement 8.5, 8.6).
    /// </summary>
    public IReadOnlyList<Guid> Roster => _roster;

    /// <summary>Sets the team's display name; trimming and validation are the aggregate's concern at lock.</summary>
    internal void SetName(string teamName) => TeamName = teamName;

    /// <summary>Sets the team's bib flag; the aggregate ensures exactly one team is flagged.</summary>
    internal void SetBib(bool bibFlag) => BibFlag = bibFlag;

    /// <summary>Whether <paramref name="squadMembershipId"/> is currently on this team's roster.</summary>
    internal bool Contains(Guid squadMembershipId) => _roster.Contains(squadMembershipId);

    /// <summary>Appends <paramref name="squadMembershipId"/> to the end of the roster if not already present.</summary>
    internal void AddParticipant(Guid squadMembershipId)
    {
        if (!_roster.Contains(squadMembershipId))
        {
            _roster.Add(squadMembershipId);
        }
    }

    /// <summary>Removes <paramref name="squadMembershipId"/> from the roster; returns whether it was present.</summary>
    internal bool RemoveParticipant(Guid squadMembershipId) => _roster.Remove(squadMembershipId);
}
