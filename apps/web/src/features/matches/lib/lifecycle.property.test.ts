import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { teamSheet, workingTeams } from '../testing/matchesFixtures';
import {
  MAX_SCORE,
  canCancel,
  canComplete,
  canRecordResult,
  canStart,
  parseScoreInput,
  scoreLines,
  workingTeamsAreLocked,
} from './lifecycle';
import type { RecordedResult } from './parse/matchDetail';
import { MATCH_STATE_NAMES } from './wireEnums';

const RESULT: RecordedResult = { fidelity: 'Basic', teamScores: [] };

describe('which step each state offers', () => {
  it('offers start only once locked, cancel only before kick-off, and scoring only in play', () => {
    for (const state of MATCH_STATE_NAMES) {
      expect(canStart(state)).toBe(state === 'TeamsRolled');
      expect(canCancel(state)).toBe(
        state === 'GatheringAvailability' || state === 'Confirmed' || state === 'TeamsRolled',
      );
      expect(canRecordResult(state)).toBe(state === 'InProgress');
      expect(canComplete(state, RESULT)).toBe(state === 'InProgress');
      expect(canComplete(state, null)).toBe(false);
    }
  });
});

describe('parseScoreInput', () => {
  it('reads every whole number from 0 to the maximum, however it is padded', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: MAX_SCORE }), fc.constantFrom('', ' ', '  '), (score, pad) => {
        expect(parseScoreInput(`${pad}${score}${pad}`)).toEqual({ ok: true, value: score });
      }),
    );
  });

  it('refuses anything that is not a whole number in range', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer({ min: MAX_SCORE + 1 }).map(String),
          fc.integer({ max: -1 }).map(String),
          fc.double({ noInteger: true, noNaN: true }).map(String),
          fc.string().filter((text) => !/^\s*\d{1,2}\s*$/.test(text)),
        ),
        (text) => {
          expect(parseScoreInput(text).ok).toBe(false);
        },
      ),
    );
  });
});

describe('scoreLines', () => {
  const sheet = teamSheet();
  const [first, second] = sheet.teams;

  it('sets each score beside its own team, in sheet order, whatever order the result lists them in', () => {
    fc.assert(
      fc.property(fc.nat(MAX_SCORE), fc.nat(MAX_SCORE), fc.boolean(), (a, b, reversed) => {
        const teamScores = [
          { teamId: first.teamId, score: a },
          { teamId: second.teamId, score: b },
        ];
        const lines = scoreLines(sheet, {
          fidelity: 'Basic',
          teamScores: reversed ? teamScores.reverse() : teamScores,
        });

        expect(lines?.map(({ teamId, score }) => [teamId, score])).toEqual([
          [first.teamId, a],
          [second.teamId, b],
        ]);
        const outcomes = lines?.map(({ outcome }) => outcome);
        expect(outcomes).toEqual(a === b ? ['draw', 'draw'] : a > b ? ['win', 'loss'] : ['loss', 'win']);
      }),
    );
  });

  it('shows nothing for a result that does not score exactly the sheet’s teams', () => {
    const stranger = '0198e2a7-9999-7a5e-9c2f-6b1d4a5e7f01';
    for (const teamScores of [
      [{ teamId: first.teamId, score: 1 }],
      [
        { teamId: first.teamId, score: 1 },
        { teamId: stranger, score: 0 },
      ],
      [
        { teamId: first.teamId, score: 1 },
        { teamId: first.teamId, score: 2 },
      ],
    ]) {
      expect(scoreLines(sheet, { fidelity: 'Basic', teamScores })).toBeNull();
    }
  });
});

describe('workingTeamsAreLocked', () => {
  const sheet = teamSheet();

  it('holds for the very teams the sheet was locked from', () => {
    expect(workingTeamsAreLocked(sheet, workingTeams())).toBe(true);
  });

  it('fails for a moved player, a new name, a moved bib, a new team identity, or a player on no team', () => {
    const teams = workingTeams();
    const [red, blue] = teams.teams;
    const variants = [
      { ...teams, teams: [{ ...red, roster: red.roster.slice(1) }, { ...blue, roster: [...blue.roster, red.roster[0]] }] },
      { ...teams, teams: [{ ...red, teamName: 'Renamed' }, blue] },
      { ...teams, teams: [{ ...red, bibFlag: !red.bibFlag }, { ...blue, bibFlag: !blue.bibFlag }] },
      { ...teams, teams: [{ ...red, teamId: '0198e2a7-9999-7a5e-9c2f-6b1d4a5e7f01' }, blue] },
      { ...teams, unassigned: [red.roster[0].membershipId] },
    ];

    for (const working of variants) {
      expect(workingTeamsAreLocked(sheet, working)).toBe(false);
    }
  });
});
