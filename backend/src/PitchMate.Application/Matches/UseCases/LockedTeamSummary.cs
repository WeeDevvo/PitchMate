namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// One locked team of a match's kickoff lineup as a match list row reports it: the team's name and
/// its bib flag, and nothing else (Requirement 1.7).
/// <para>
/// It deliberately carries <b>no roster</b>, no <see cref="PitchMate.Domain.Matches.RosterEntry"/>
/// and no squad-membership identity, so a list row discloses no lineup. The lineup itself is served
/// by the match detail read and by the team sheet, each behind its own gate; the list exists to tell
/// a squad member what has been played and what is coming up, which needs the team names and the
/// bibbed side only.
/// </para>
/// <para>
/// Both members are non-nullable, so the exporter emits both as <c>required</c>. A match that has
/// locked no kickoff lineup is reported as an <b>empty</b> collection of these summaries rather than
/// by omitting the member (Requirement 1.8).
/// </para>
/// </summary>
/// <param name="TeamName">The locked team's name, exactly as the match aggregate holds it.</param>
/// <param name="BibFlag"><see langword="true"/> when this is the match's bib-wearing team.</param>
public sealed record LockedTeamSummary(
    string TeamName,
    bool BibFlag);
