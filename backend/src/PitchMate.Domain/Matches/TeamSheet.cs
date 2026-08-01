namespace PitchMate.Domain.Matches;

/// <summary>
/// The read model presented once a match reaches <see cref="MatchState.TeamsRolled"/>: the match's
/// <see cref="Location"/>, its <see cref="ConfirmedDay"/>, and each team with its name, bib flag, and
/// roster of participant display names in roster order (Requirement 9.1). Exactly one team on the
/// sheet is indicated as the bib-wearing team, corresponding to the team whose bib flag is
/// <see langword="true"/> (Requirement 9.2).
/// <para>
/// The sheet is projected from the immutable <see cref="KickoffLineup"/> captured at team lock — the
/// authoritative snapshot of the locked teams — with each roster's membership identities resolved to
/// the display-name-at-time carried on the match's <see cref="MatchParticipant"/> pool, in the order
/// the members appear on the locked team. A re-lock while <see cref="MatchState.TeamsRolled"/>
/// recaptures the lineup, so re-projecting yields a sheet reflecting the newly locked teams
/// (Requirement 9.3).
/// </para>
/// <para>
/// This is a pure Domain value with no persistence identity, produced only by
/// <see cref="Match.ProduceTeamSheet"/>. Squad-scoped visibility of the sheet is the Application
/// layer's concern (Requirement 9.4, 9.5), mirroring how authorisation is left to the caller for the
/// availability tally.
/// </para>
/// </summary>
public sealed class TeamSheet
{
    private readonly List<TeamSheetTeam> _teams;

    private TeamSheet(string location, CandidateDay confirmedDay, IEnumerable<TeamSheetTeam> teams)
    {
        Location = location;
        ConfirmedDay = confirmedDay;
        _teams = [.. teams];
    }

    /// <summary>The trimmed place the match is played, shown on the sheet (Requirement 9.1).</summary>
    public string Location { get; }

    /// <summary>The confirmed scheduled day-and-time of the match (Requirement 9.1).</summary>
    public CandidateDay ConfirmedDay { get; }

    /// <summary>
    /// The teams on the sheet, in their locked order, each with its name, bib flag, and roster of
    /// participant display names in roster order. Exactly one team carries a <see langword="true"/>
    /// <see cref="TeamSheetTeam.BibFlag"/> (Requirement 9.2).
    /// </summary>
    public IReadOnlyList<TeamSheetTeam> Teams => _teams;

    /// <summary>
    /// Projects the team sheet for <paramref name="match"/> from its captured
    /// <see cref="Match.KickoffLineup"/> and <see cref="Match.Participants"/>. Called only by
    /// <see cref="Match.ProduceTeamSheet"/> once the match's state has been verified as
    /// <see cref="MatchState.TeamsRolled"/>, which guarantees both a captured lineup and a confirmed
    /// day are present. Each locked team's ordered roster of membership identities is resolved to the
    /// participants' display-names-at-time, preserving the team's roster order (Requirement 9.1); the
    /// per-team bib flags are carried through unchanged, so the single flagged team is indicated as the
    /// bib-wearing team (Requirement 9.2).
    /// </summary>
    /// <param name="match">The match to project, guaranteed by the caller to be in <see cref="MatchState.TeamsRolled"/>.</param>
    /// <returns>The projected <see cref="TeamSheet"/>.</returns>
    internal static TeamSheet Project(Match match)
    {
        var lineup = match.KickoffLineup!;
        var displayNamesByMembership = match.Participants
            .ToDictionary(participant => participant.SquadMembershipId, participant => participant.DisplayName);

        var teams = lineup.Teams.Select(team => new TeamSheetTeam(
            team.TeamName,
            team.BibFlag,
            team.ParticipantMembershipIds.Select(membershipId =>
                displayNamesByMembership.TryGetValue(membershipId, out var displayName)
                    ? displayName
                    : string.Empty)));

        return new TeamSheet(match.Location, match.ConfirmedDay!.Value, teams);
    }
}
