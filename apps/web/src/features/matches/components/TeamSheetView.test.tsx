import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { playerStatsPath } from '../../squads';
import { dayParts } from '../lib/matchDays';
import {
  KICKOFF_LABEL,
  TEAM_SHEET_HEADING,
  VENUE_LABEL,
  WEARS_BIBS_BADGE,
  kickOffTimeText,
  teamSheetHeading,
} from '../lib/messages';
import { parseTeamSheet } from '../lib/parse/teamSheet';
import { DAY_ISO, DAY_MS, SQUAD_ID, playerId, teamSheet } from '../testing/matchesFixtures';
import { TeamSheetView } from './TeamSheetView';

function renderSheet(sheet = teamSheet(), extra: { squadName?: string; guestIds?: ReadonlySet<string> } = {}) {
  render(
    <MemoryRouter>
      <TeamSheetView squadId={SQUAD_ID} sheet={sheet} {...extra} />
    </MemoryRouter>,
  );
}

function teamSection(name: string): HTMLElement {
  return screen.getByRole('heading', { level: 3, name }).closest('section') as HTMLElement;
}

describe('TeamSheetView', () => {
  it('states when and where the match is', () => {
    renderSheet();

    expect(screen.getByRole('heading', { level: 2, name: TEAM_SHEET_HEADING })).toBeTruthy();
    const day = dayParts(DAY_MS[1]);
    const time = screen.getByText(`${day.dow} ${day.num} ${day.mon}`);
    expect(time.getAttribute('dateTime')).toBe(DAY_ISO[1]);
    // Each fact is read after its word, though only the icon shows it.
    const facts = screen.getAllByRole('term').map((term) => `${term.textContent}: ${term.nextElementSibling?.textContent}`);
    expect(facts).toEqual([`${KICKOFF_LABEL}: ${kickOffTimeText(day.time)}`, `${VENUE_LABEL}: Riverside 5s, pitch 2`]);
  });

  it('names the squad in the heading once it is known', () => {
    renderSheet(teamSheet(), { squadName: 'Thursday Ballers' });
    expect(screen.getByRole('heading', { level: 2, name: teamSheetHeading('Thursday Ballers') })).toBeTruthy();
  });

  it('badges the guests, and only the guests', () => {
    renderSheet(teamSheet(), { guestIds: new Set([playerId(1).toLowerCase()]) });

    const blue = within(teamSection('Blue Herons'));
    const items = blue.getAllByRole('listitem');
    expect(within(items[0]).getByText('Guest')).toBeTruthy();
    expect(within(items[1]).queryByText('Guest')).toBeNull();
  });

  it('flags the bib team in words, and only that team', () => {
    renderSheet();

    expect(within(teamSection('Red Wolves')).getByRole('img', { name: WEARS_BIBS_BADGE })).toBeTruthy();
    expect(within(teamSection('Blue Herons')).queryByRole('img', { name: WEARS_BIBS_BADGE })).toBeNull();
    expect(within(teamSection('Blue Herons')).getByText('No bibs')).toBeTruthy();
  });

  it('links each player to their stats in this squad', () => {
    renderSheet();

    const players = within(teamSection('Blue Herons')).getAllByRole('link');
    expect(players.map((link) => link.textContent)).toEqual([
      'Player 2',
      'Player 4',
      'Player 6',
      'Player 8',
      'Player 10',
    ]);
    expect(players[0].getAttribute('href')).toBe(playerStatsPath(SQUAD_ID, playerId(1)));
  });
});

describe('parseTeamSheet', () => {
  const wire = {
    location: 'Riverside 5s, pitch 2',
    confirmedDay: DAY_ISO[1],
    teams: teamSheet().teams.map((team) => ({
      teamId: team.teamId,
      teamName: team.teamName,
      bibFlag: team.bibFlag,
      roster: team.roster.map((entry) => ({
        squadMembershipId: entry.membershipId,
        displayName: entry.displayName,
      })),
    })),
  };

  it('reads the contract shape', () => {
    expect(parseTeamSheet(wire)).toEqual({ ok: true, value: teamSheet() });
  });

  it('requires every member the contract leaves optional', () => {
    for (const field of ['location', 'confirmedDay', 'teams'] as const) {
      const body: Record<string, unknown> = { ...wire };
      delete body[field];
      expect(parseTeamSheet(body).ok).toBe(false);
    }
    expect(
      parseTeamSheet({ ...wire, teams: [{ teamName: 'A', bibFlag: true, roster: null }] }).ok,
    ).toBe(false);
  });

  it('requires each team to carry the identity its score is given against', () => {
    for (const teamId of [undefined, null, 'not-an-id']) {
      const teams = wire.teams.map((team, index) => (index === 0 ? { ...team, teamId } : team));
      expect(parseTeamSheet({ ...wire, teams }).ok).toBe(false);
    }
  });
});
