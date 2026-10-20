using PitchMate.Domain.Matches;

namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// One working team (match-read-models Requirements 4.2–4.6).
/// <para>
/// <see cref="TeamId"/> is the <c>MatchTeam</c> identity that <c>PUT /matches/{matchId}/teams/{teamId}/name</c>
/// and <c>…/bib</c> accept — the reason this read exists, since no other response returns it.
/// <see cref="TeamName"/> and <see cref="BibFlag"/> are exactly as stored: no trimming, no substitution,
/// and no correction of an arrangement in which zero or two teams wear bibs, because the aggregate
/// enforces those only at lock. <see cref="Roster"/> is in stored order, so a moved participant sits
/// last, and uses the Domain <see cref="RosterEntry"/> the team sheet shares.
/// </para>
/// </summary>
/// <param name="TeamId">The team's identity, accepted by both team-editing writes.</param>
/// <param name="TeamName">The team name as stored.</param>
/// <param name="BibFlag">Whether the team is flagged to wear bibs, as stored.</param>
/// <param name="Roster">The team's members in stored order, each with the display name at time of play.</param>
public sealed record WorkingTeamView(
    Guid TeamId,
    string TeamName,
    bool BibFlag,
    IReadOnlyList<RosterEntry> Roster);
