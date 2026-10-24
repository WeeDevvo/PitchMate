import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { playerStatsPath } from '../../squads';
import { formatDay } from '../lib/matchDays';
import { TEAM_SHEET_HEADING, WEARS_BIBS_BADGE } from '../lib/messages';
import { parseTeamSheet } from '../lib/parse/teamSheet';
import { DAY_ISO, DAY_MS, SQUAD_ID, playerId, teamSheet } from '../testing/matchesFixtures';
import { TeamSheetView } from './TeamSheetView';

function renderSheet(sheet = teamSheet()) {
  render(
    <MemoryRouter>
      <TeamSheetView squadId={SQUAD_ID} sheet={sheet} />
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
    expect(screen.getByText(formatDay(DAY_MS[1]))).toBeTruthy();
    expect(screen.getByText('Riverside 5s, pitch 2')).toBeTruthy();
  });

  it('flags the bib team in words, and only that team', () => {
    renderSheet();

    expect(within(teamSection('Red Wolves')).getByText(WEARS_BIBS_BADGE)).toBeTruthy();
    expect(within(teamSection('Blue Herons')).queryByText(WEARS_BIBS_BADGE)).toBeNull();
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
