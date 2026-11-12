/**
 * The squad card's facts as the card shows them: the counts pluralised, a
 * confirmed next match by its day and place, one still gathering availability as
 * "Pick a day" with its candidate-day count, no next match as `null`, and the
 * form as W / D / L letters in the order the backend gave them.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { SQUAD_CARD_PICK_A_DAY } from './messages';
import { MATCH_STATE_NAMES, PLAYER_RESULT_NAMES } from './wireEnums';
import {
  candidateDaysLabel,
  matchDayLabel,
  playerCountLabel,
  squadCardView,
} from './squadCardView';

const MATCH_ID = '00000000-0000-1000-8000-000000000000';
const MONDAY_9_NOV_10AM_UTC = Date.UTC(2026, 10, 9, 10, 0, 0);

describe('squadCardView', () => {
  it('pluralises the player and candidate-day counts', () => {
    expect(playerCountLabel(1)).toBe('1 player');
    expect(playerCountLabel(0)).toBe('0 players');
    expect(playerCountLabel(14)).toBe('14 players');
    expect(candidateDaysLabel(1)).toBe('1 candidate day');
    expect(candidateDaysLabel(3)).toBe('3 candidate days');
  });

  it('shows a confirmed day as weekday, day, month and 24-hour time in the given zone', () => {
    expect(matchDayLabel(MONDAY_9_NOV_10AM_UTC, 'UTC')).toBe('Mon 9 Nov · 10:00');
    expect(matchDayLabel(Date.UTC(2026, 6, 9, 19, 5), 'Europe/London')).toBe('Thu 9 Jul · 20:05');
  });

  it('shows a confirmed next match by its day and place', () => {
    const view = squadCardView(
      {
        playerCount: 14,
        nextMatch: {
          matchId: MATCH_ID,
          state: 'TeamsRolled',
          scheduledAtMs: MONDAY_9_NOV_10AM_UTC,
          place: 'Hackney Marshes',
          candidateDayCount: 3,
        },
        recentForm: ['Win', 'Win', 'Draw', 'Loss', 'Win'],
      },
      'UTC',
    );

    expect(view).toStrictEqual({
      players: '14 players',
      next: { state: 'rolled', title: 'Mon 9 Nov · 10:00', sub: 'Hackney Marshes' },
      form: ['W', 'W', 'D', 'L', 'W'],
    });
  });

  it('shows a match still gathering availability as "Pick a day" with its candidate days', () => {
    const view = squadCardView({
      playerCount: 9,
      nextMatch: {
        matchId: MATCH_ID,
        state: 'GatheringAvailability',
        scheduledAtMs: null,
        place: 'Powerleague',
        candidateDayCount: 3,
      },
      recentForm: [],
    });

    expect(view.next).toStrictEqual({
      state: 'gathering',
      title: SQUAD_CARD_PICK_A_DAY,
      sub: '3 candidate days',
    });
    expect(view.form).toStrictEqual([]);
  });

  it('maps every state and every result, keeps the form in order, and has no next match without one', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...MATCH_STATE_NAMES),
        fc.array(fc.constantFrom(...PLAYER_RESULT_NAMES), { maxLength: 5 }),
        fc.nat({ max: 400 }),
        (state, recentForm, playerCount) => {
          const view = squadCardView(
            {
              playerCount,
              nextMatch: {
                matchId: MATCH_ID,
                state,
                scheduledAtMs: MONDAY_9_NOV_10AM_UTC,
                place: 'Pitch',
                candidateDayCount: 1,
              },
              recentForm,
            },
            'UTC',
          );

          expect(view.next?.state).toMatch(/^(gathering|confirmed|rolled|live|completed|cancelled)$/);
          expect(view.form).toStrictEqual(recentForm.map((result) => result[0]));
          expect(squadCardView({ playerCount, nextMatch: null, recentForm }).next).toBeNull();
        },
      ),
      { numRuns: 200 },
    );
  });
});
