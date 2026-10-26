import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  GUESTS,
  MATCH_ID,
  SQUAD_ID,
  TEAM_IDS,
  playerId,
  workingTeam,
  workingTeams,
} from '../testing/matchesFixtures';
import { guestsOf, parseSquadPlayers, parseWorkingTeams } from './parse/teams';
import {
  ROLL_MAX_PARTICIPANTS,
  ROLL_MIN_PARTICIPANTS,
  TEAM_MAX_SIZE,
  TEAM_MIN_SIZE,
  formatProbability,
  lockProblems,
  participantsEditable,
  rollGap,
  teamsEditable,
} from './teams';
import { MATCH_STATE_NAMES } from './wireEnums';

describe('lockProblems', () => {
  it('finds nothing in two valid teams with one bib and nobody left over', () => {
    expect(lockProblems(workingTeams().teams, 0)).toEqual([]);
  });

  it('flags a team outside the size bounds, and only such a team', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 12 }), (size) => {
        const teams = [
          workingTeam(0, Array.from({ length: size }, (_, index) => index)),
          workingTeam(1, [20, 21, 22, 23, 24]),
        ];
        const flagged = lockProblems(teams, 0).filter((problem) => problem.kind === 'team-size');
        const valid = size >= TEAM_MIN_SIZE && size <= TEAM_MAX_SIZE;
        expect(flagged).toEqual(valid ? [] : [{ kind: 'team-size', teamName: 'Red Wolves', size }]);
      }),
    );
  });

  it('requires exactly one bib once there are teams', () => {
    const none = [workingTeam(0, [0, 1, 2, 3, 4], false), workingTeam(1, [5, 6, 7, 8, 9], false)];
    const both = [workingTeam(0, [0, 1, 2, 3, 4], true), workingTeam(1, [5, 6, 7, 8, 9], true)];

    expect(lockProblems(none, 0)).toEqual([{ kind: 'bib-count', count: 0 }]);
    expect(lockProblems(both, 0)).toEqual([{ kind: 'bib-count', count: 2 }]);
  });

  it('needs two teams, and counts players on no team', () => {
    expect(lockProblems([], 0)).toEqual([{ kind: 'too-few-teams' }]);
    expect(lockProblems(workingTeams().teams, 2)).toEqual([{ kind: 'unassigned', count: 2 }]);
  });
});

describe('rollGap', () => {
  it('is null exactly in the rollable range, and otherwise closes the gap to it', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 40 }), (count) => {
        const gap = rollGap(count);
        const inRange = count >= ROLL_MIN_PARTICIPANTS && count <= ROLL_MAX_PARTICIPANTS;
        expect(gap === null).toBe(inRange);
        if (gap === null) return;
        const after = gap.kind === 'add' ? count + gap.count : count - gap.count;
        expect(gap.count).toBeGreaterThan(0);
        expect(after).toBe(gap.kind === 'add' ? ROLL_MIN_PARTICIPANTS : ROLL_MAX_PARTICIPANTS);
      }),
    );
  });
});

describe('state rules and formatting', () => {
  it('allows team changes while confirmed or locked, and player changes only while confirmed', () => {
    expect(MATCH_STATE_NAMES.filter(teamsEditable)).toEqual(['Confirmed', 'TeamsRolled']);
    expect(MATCH_STATE_NAMES.filter(participantsEditable)).toEqual(['Confirmed']);
  });

  it('shows a probability as a whole percentage', () => {
    expect(formatProbability(0)).toBe('0%');
    expect(formatProbability(0.456)).toBe('46%');
    expect(formatProbability(1)).toBe('100%');
  });
});

describe('parseWorkingTeams', () => {
  const wire = {
    teams: [
      {
        teamId: TEAM_IDS[0],
        teamName: 'Red Wolves',
        bibFlag: true,
        roster: [0, 2, 4, 6, 8].map((index) => ({
          squadMembershipId: playerId(index),
          displayName: `Player ${index + 1}`,
        })),
      },
      {
        teamId: TEAM_IDS[1],
        teamName: 'Blue Herons',
        bibFlag: false,
        roster: [1, 3, 5, 7, 9].map((index) => ({
          squadMembershipId: playerId(index),
          displayName: `Player ${index + 1}`,
        })),
      },
    ],
    prediction: { winProbabilities: [0.46, 0.44], drawProbability: 0.1 },
    unassignedParticipants: [],
  };

  it('reads the contract shape', () => {
    expect(parseWorkingTeams(wire)).toEqual({ ok: true, value: workingTeams() });
  });

  it('reads a missing prediction as none', () => {
    const parsed = parseWorkingTeams({ ...wire, prediction: null });
    expect(parsed.ok && parsed.value.prediction).toBeNull();
  });

  it('rejects a probability outside 0 to 1, or one per team too few', () => {
    for (const prediction of [
      { winProbabilities: [1.2, 0], drawProbability: 0 },
      { winProbabilities: [0.5, 0.5], drawProbability: -0.1 },
      { winProbabilities: [0.5], drawProbability: 0.1 },
    ]) {
      expect(parseWorkingTeams({ ...wire, prediction }).ok).toBe(false);
    }
  });

  it('never raises', () => {
    fc.assert(
      fc.property(fc.anything(), (value) => {
        expect(typeof parseWorkingTeams(value).ok).toBe('boolean');
      }),
    );
  });
});

describe('parseSquadPlayers', () => {
  const member = (
    membershipId: string,
    displayName: string,
    isGuest: boolean,
    state: string | null = 'Active',
  ) => ({
    membershipId,
    displayName,
    role: isGuest ? null : 'Member',
    state,
    isGuest,
    appearances: 0,
    ratingState: null,
  });

  it('keeps every active member and guest, and the guests among them', () => {
    const parsed = parseSquadPlayers({
      squadId: SQUAD_ID,
      name: 'Tuesday 5s',
      features: [],
      members: [
        member(MATCH_ID, 'Alex', false),
        member(GUESTS[0].membershipId, GUESTS[0].displayName, true),
        member(playerId(1), 'Old Guest', true, 'Inactive'),
        member(playerId(2), 'Gone Member', false, 'Inactive'),
      ],
    });

    expect(parsed).toEqual({
      ok: true,
      value: [
        { membershipId: MATCH_ID, displayName: 'Alex', isGuest: false },
        { ...GUESTS[0], isGuest: true },
      ],
    });
    expect(parsed.ok && guestsOf(parsed.value)).toEqual(GUESTS);
  });

  it('fails the body on one malformed member', () => {
    expect(
      parseSquadPlayers({ members: [member('not-an-id', 'Alex', true)] }).ok,
    ).toBe(false);
  });
});
