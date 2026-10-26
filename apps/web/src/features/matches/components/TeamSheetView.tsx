/**
 * The team sheet: when and where, both named teams with their players, and a
 * clear flag on the team that wears bibs. The flag is a labelled badge with a
 * mark, never colour alone. Each player links to their stats in this squad.
 */
import { useId, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { TeamColumn } from '../../../ui';

import { playerStatsPath } from '../../squads';
import { formatDay } from '../lib/matchDays';
import {
  KICKOFF_LABEL,
  TEAM_SHEET_HEADING,
  VENUE_LABEL,
  WEARS_BIBS_BADGE,
  playerCountStatement,
} from '../lib/messages';
import type { TeamSheet } from '../lib/parse/teamSheet';

export interface TeamSheetViewProps {
  readonly squadId: string;
  readonly sheet: TeamSheet;
}

export function TeamSheetView({ squadId, sheet }: TeamSheetViewProps): ReactElement {
  const headingId = useId();

  return (
    <section className="matches-panel matches-sheet" aria-labelledby={headingId}>
      <h2 id={headingId} className="matches-subheading">
        {TEAM_SHEET_HEADING}
      </h2>
      <dl className="matches-facts">
        <div>
          <dt>{KICKOFF_LABEL}</dt>
          <dd>
            <time dateTime={new Date(sheet.kickoffMs).toISOString()}>{formatDay(sheet.kickoffMs)}</time>
          </dd>
        </div>
        <div>
          <dt>{VENUE_LABEL}</dt>
          <dd>{sheet.location}</dd>
        </div>
      </dl>
      <div className="matches-teams">
        {sheet.teams.map((team, index) => {
          const teamHeadingId = `${headingId}-${index}`;
          return (
            <TeamColumn
              key={`${index}-${team.teamName}`}
              className="matches-team"
              side={index % 2 === 0 ? 'a' : 'b'}
              data-bibs={team.bibFlag}
              aria-labelledby={teamHeadingId}
              // The bib team carries the flag, named in the sheet's own words; the
              // other carries nothing.
              bibs={team.bibFlag}
              bibsLabel={WEARS_BIBS_BADGE}
              heading={
                <h3 id={teamHeadingId} className="matches-team__heading">
                  {team.teamName}
                </h3>
              }
              meta={playerCountStatement(team.roster.length)}
            >
              <ul className="matches-people">
                {team.roster.map((player) => (
                  <li key={player.membershipId}>
                    <Link
                      className="matches-link"
                      to={playerStatsPath(squadId, player.membershipId)}
                    >
                      {player.displayName}
                    </Link>
                  </li>
                ))}
              </ul>
            </TeamColumn>
          );
        })}
      </div>
    </section>
  );
}

export default TeamSheetView;
