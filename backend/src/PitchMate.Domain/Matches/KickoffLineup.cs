namespace PitchMate.Domain.Matches;

/// <summary>
/// The immutable snapshot of a match's teams and their rosters captured at team lock — the single
/// rating unit for the match (Requirement 10.1, 10.3). Once captured, the lineup never changes for a
/// given lock: late arrivals, early leavers, and substitutions are recorded elsewhere as stats-only
/// participation data and never alter it (Requirement 10.2). Re-locking a match while it is in
/// <see cref="MatchState.TeamsRolled"/> replaces the lineup wholesale with a fresh capture of the
/// newly locked teams (Requirement 9.3), rather than mutating an existing one.
/// <para>
/// The lineup is the sole input to the completion rating update: the derived match outcome contains
/// exactly one ranked team per <see cref="KickoffTeam"/> and every participant of the lineup
/// (Requirement 10.4). It is a pure Domain value with no persistence identity, captured only by the
/// owning <see cref="Match"/> aggregate.
/// </para>
/// </summary>
public sealed class KickoffLineup
{
    private readonly List<KickoffTeam> _teams;

    private KickoffLineup(IEnumerable<KickoffTeam> teams) => _teams = [.. teams];

    /// <summary>The teams captured at lock, in their locked order, each with its name, bib flag, and roster.</summary>
    public IReadOnlyList<KickoffTeam> Teams => _teams;

    /// <summary>
    /// Captures an immutable lineup from <paramref name="teams"/>, copying each team's name, bib flag,
    /// and ordered roster so subsequent edits to the working teams cannot affect the captured lineup.
    /// Called only by the owning <see cref="Match"/> aggregate on a successful lock.
    /// </summary>
    /// <param name="teams">The validated, locked working teams to snapshot, in order.</param>
    /// <returns>A fresh immutable <see cref="KickoffLineup"/> mirroring the locked teams.</returns>
    internal static KickoffLineup Capture(IEnumerable<MatchTeam> teams) =>
        new(teams.Select(team => new KickoffTeam(team.TeamName, team.BibFlag, team.Roster)));
}
