namespace PitchMate.Domain.Matches;

/// <summary>
/// One team within an immutable <see cref="KickoffLineup"/>: the team's <see cref="TeamName"/>, its
/// <see cref="BibFlag"/>, and the ordered squad-membership identities that made up its roster at team
/// lock. Each kickoff team maps one-to-one onto a ranked team in the match outcome fed to the rating
/// engine at completion, and every roster identity is a participant of the match (Requirement 10.4).
/// </summary>
/// <remarks>
/// This is a pure Domain value with no persistence identity, created only by
/// <see cref="KickoffLineup.Capture"/>. Its roster is a defensive copy, so the captured team is
/// unaffected by later edits to the working <see cref="MatchTeam"/> it was snapshotted from
/// (Requirement 10.3).
/// </remarks>
public sealed class KickoffTeam
{
    private readonly List<Guid> _participantMembershipIds;

    /// <summary>
    /// Creates a captured team from its <paramref name="teamName"/>, <paramref name="bibFlag"/>, and
    /// ordered <paramref name="participantMembershipIds"/>. Called only by
    /// <see cref="KickoffLineup.Capture"/>.
    /// </summary>
    /// <param name="teamName">The team's locked display name.</param>
    /// <param name="bibFlag"><see langword="true"/> when this team wore bibs for the match.</param>
    /// <param name="participantMembershipIds">The ordered squad-membership identities on the team at lock.</param>
    internal KickoffTeam(string teamName, bool bibFlag, IEnumerable<Guid> participantMembershipIds)
    {
        TeamName = teamName;
        BibFlag = bibFlag;
        _participantMembershipIds = [.. participantMembershipIds];
    }

    /// <summary>The team's locked display name.</summary>
    public string TeamName { get; }

    /// <summary>Whether this team wore bibs for the match.</summary>
    public bool BibFlag { get; }

    /// <summary>The ordered squad-membership identities that made up this team's roster at lock.</summary>
    public IReadOnlyList<Guid> ParticipantMembershipIds => _participantMembershipIds;
}
