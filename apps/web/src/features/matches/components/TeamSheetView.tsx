/**
 * The team sheet: when and where, both named teams with their players, and a
 * clear flag on the team that wears bibs. The flag is a labelled badge with a
 * mark, never colour alone. Each player links to their stats in this squad.
 * It is drawn as the design system's shareable card, built to be screenshotted
 * into the group chat.
 */
import { useId, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { GuestBadge, TeamSheetCard, TeamSheetPlayer, TeamSheetSide } from '../../../ui';

import { playerStatsPath } from '../../squads';
import { dayParts } from '../lib/matchDays';
import {
  KICKOFF_LABEL,
  VENUE_LABEL,
  WEARS_BIBS_BADGE,
  kickOffTimeText,
  teamSheetHeading,
  teamSideLabel,
  teamSizesStatement,
} from '../lib/messages';
import type { TeamSheet } from '../lib/parse/teamSheet';

export interface TeamSheetViewProps {
  readonly squadId: string;
  readonly sheet: TeamSheet;
  /** The squad's name for the sheet's heading, once known. */
  readonly squadName?: string;
  /** The players who are guests, by membership id, for their badge. */
  readonly guestIds?: ReadonlySet<string>;
}

export function TeamSheetView({ squadId, sheet, squadName, guestIds }: TeamSheetViewProps): ReactElement {
  const headingId = useId();
  const day = dayParts(sheet.kickoffMs);
  const isGuest = (membershipId: string): boolean => guestIds?.has(membershipId.toLowerCase()) ?? false;

  return (
    <TeamSheetCard
      className="matches-sheet"
      aria-labelledby={headingId}
      heading={<h2 id={headingId}>{teamSheetHeading(squadName)}</h2>}
      day={`${day.dow} ${day.num} ${day.mon}`}
      dateTime={new Date(sheet.kickoffMs).toISOString()}
      time={kickOffTimeText(day.time)}
      timeLabel={KICKOFF_LABEL}
      location={sheet.location}
      locationLabel={VENUE_LABEL}
      footer={teamSizesStatement(sheet.teams.map((team) => team.roster.length))}
    >
      {sheet.teams.map((team, index) => {
        const teamHeadingId = `${headingId}-${index}`;
        return (
          <TeamSheetSide
            key={`${index}-${team.teamName}`}
            side={index % 2 === 0 ? 'a' : 'b'}
            sideLabel={teamSideLabel(index)}
            data-bibs={team.bibFlag}
            aria-labelledby={teamHeadingId}
            // The bib team carries the flag, named in the sheet's own words; the
            // other says it has none.
            bibs={team.bibFlag}
            bibsLabel={WEARS_BIBS_BADGE}
            heading={<h3 id={teamHeadingId}>{team.teamName}</h3>}
          >
            {team.roster.map((player) => {
              const guest = isGuest(player.membershipId);
              return (
                <TeamSheetPlayer
                  key={player.membershipId}
                  name={player.displayName}
                  guest={guest}
                  badges={guest ? <GuestBadge /> : undefined}
                  nameContent={
                    <Link className="matches-link" to={playerStatsPath(squadId, player.membershipId)}>
                      {player.displayName}
                    </Link>
                  }
                />
              );
            })}
          </TeamSheetSide>
        );
      })}
    </TeamSheetCard>
  );
}

export default TeamSheetView;
