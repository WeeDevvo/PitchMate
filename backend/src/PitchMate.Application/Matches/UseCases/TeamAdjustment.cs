namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// A single adjustment an organiser makes to a match's working teams while rolling them
/// (Requirement 8.3). Modelled as a closed union — its only cases are the nested records — so
/// <see cref="AdjustTeamsHandler"/> can exhaustively map each supported edit onto the corresponding
/// <c>Match</c> aggregate behaviour: moving a participant between teams, re-rolling a fresh balanced
/// assignment, renaming a team (generating a silly name when none is supplied, Requirement 8.4), and
/// choosing the single bib-wearing team. The private constructor prevents any further case being
/// declared outside this type.
/// </summary>
public abstract record TeamAdjustment
{
    private TeamAdjustment()
    {
    }

    /// <summary>
    /// Moves the participant <paramref name="SquadMembershipId"/> onto the working team
    /// <paramref name="ToTeamId"/>, preserving the exact partition of participants across teams
    /// (Requirement 8.2, 8.3). Applied via <c>Match.MoveParticipant</c>.
    /// </summary>
    /// <param name="SquadMembershipId">The identity of the participant to move.</param>
    /// <param name="ToTeamId">The identity of the destination working team.</param>
    public sealed record MoveParticipant(Guid SquadMembershipId, Guid ToTeamId) : TeamAdjustment;

    /// <summary>
    /// Re-rolls the working teams by requesting a fresh balanced assignment and applying it
    /// (Requirement 8.3). Existing team names and bib flags are preserved by position when the match
    /// already has working teams; on a first roll each team is given a generated silly name and the
    /// first team is flagged to wear bibs (Requirement 8.4).
    /// </summary>
    public sealed record ReRoll : TeamAdjustment;

    /// <summary>
    /// Sets the name of the working team <paramref name="TeamId"/> to <paramref name="TeamName"/>
    /// (Requirement 8.3). When <paramref name="TeamName"/> is <see langword="null"/> or blank the
    /// admin has supplied none, so a name is drawn from the silly-name generator (Requirement 8.4).
    /// Applied via <c>Match.SetTeamName</c>; length and uniqueness are validated at lock.
    /// </summary>
    /// <param name="TeamId">The identity of the working team to rename.</param>
    /// <param name="TeamName">The requested name, or <see langword="null"/>/blank to generate one.</param>
    public sealed record SetTeamName(Guid TeamId, string? TeamName) : TeamAdjustment;

    /// <summary>
    /// Marks the working team <paramref name="TeamId"/> as the single bib-wearing team, clearing every
    /// other team's flag (Requirement 8.3). Applied via <c>Match.SetBibTeam</c>.
    /// </summary>
    /// <param name="TeamId">The identity of the working team to flag as bib-wearing.</param>
    public sealed record SetBibTeam(Guid TeamId) : TeamAdjustment;
}
