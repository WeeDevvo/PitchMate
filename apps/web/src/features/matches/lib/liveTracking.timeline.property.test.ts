/**
 * The tracker's timeline, over generated sessions of goals, keeper changes and
 * retractions:
 *
 * - every goal and keeper change the log holds appears exactly once, in minute
 *   order, and one is shown taken back exactly when a retraction names it;
 * - each correction sits straight after the event it took back;
 * - the score after each standing goal counts the standing goals up to it, so
 *   the last one is the match's score;
 * - a goal corrected with `goalCorrection` is paired with its replacement, at
 *   the original minute, whatever else the log holds.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { teamSheet } from '../testing/matchesFixtures';
import { goalCorrection, timeline, type GoalEvent, type LoggedEvent, type TrackedEvent } from './liveTracking';

const SHEET = teamSheet();
const TEAM_IDS = SHEET.teams.map(({ teamId }) => teamId);
const PLAYER = SHEET.teams[0].roster[0].membershipId;

function idOf(index: number): string {
  return `0198e2a7-9999-7a5e-9c2f-${index.toString(16).padStart(12, '0')}`;
}

type Step =
  | { readonly kind: 'goal'; readonly team: number; readonly minute: number }
  | { readonly kind: 'keeper'; readonly team: number; readonly minute: number }
  | { readonly kind: 'undo'; readonly pick: number; readonly minute: number };

const step: fc.Arbitrary<Step> = fc.oneof(
  fc.record({ kind: fc.constant('goal' as const), team: fc.integer({ min: 0, max: 1 }), minute: fc.integer({ min: 0, max: 60 }) }),
  fc.record({ kind: fc.constant('keeper' as const), team: fc.integer({ min: 0, max: 1 }), minute: fc.integer({ min: 0, max: 60 }) }),
  fc.record({ kind: fc.constant('undo' as const), pick: fc.nat(), minute: fc.integer({ min: 0, max: 60 }) }),
);

/** A recorded session from the steps: an undo takes back an earlier goal or keeper change, if there is one. */
function sessionFrom(steps: readonly Step[]): readonly LoggedEvent[] {
  const events: TrackedEvent[] = [];
  steps.forEach((s, index) => {
    const eventId = idOf(index);
    if (s.kind === 'goal') {
      events.push({ kind: 'goal', eventId, minute: s.minute, teamId: TEAM_IDS[s.team], scorerId: PLAYER, ownGoal: false });
    } else if (s.kind === 'keeper') {
      events.push({ kind: 'keeper', eventId, minute: s.minute, teamId: TEAM_IDS[s.team], keeperId: PLAYER });
    } else {
      const targets = events.filter((e) => e.kind === 'goal' || e.kind === 'keeper');
      if (targets.length === 0) return;
      const target = targets[s.pick % targets.length];
      events.push({
        kind: target.kind === 'goal' ? 'goal-undo' : 'keeper-undo',
        eventId,
        minute: s.minute,
        targetEventId: target.eventId,
      });
    }
  });
  return events.map((event) => ({ event, status: 'recorded' }));
}

describe('the tracker timeline', () => {
  it('lists every goal and keeper change once, in minute order, taken back exactly when retracted', () => {
    fc.assert(
      fc.property(fc.array(step, { maxLength: 30 }), (steps) => {
        const log = sessionFrom(steps);
        const entries = timeline(TEAM_IDS, log);
        const occurrences = entries.flatMap((entry) => (entry.kind === 'correction' ? [] : [entry]));

        const logged = log.filter(({ event }) => event.kind === 'goal' || event.kind === 'keeper').map(({ event }) => event.eventId);
        expect(occurrences.map(({ event }) => event.eventId).sort()).toEqual([...logged].sort());

        for (let index = 1; index < occurrences.length; index += 1) {
          expect(occurrences[index - 1].event.minute).toBeLessThanOrEqual(occurrences[index].event.minute);
        }

        const retracted = new Set(
          log.flatMap(({ event }) => (event.kind === 'goal-undo' || event.kind === 'keeper-undo' ? [event.targetEventId] : [])),
        );
        for (const entry of occurrences) {
          expect(entry.standing).toBe(!retracted.has(entry.event.eventId));
        }
      }),
      { numRuns: 200 },
    );
  });

  it('puts each correction straight after the event it took back', () => {
    fc.assert(
      fc.property(fc.array(step, { maxLength: 30 }), (steps) => {
        const entries = timeline(TEAM_IDS, sessionFrom(steps));
        entries.forEach((entry, index) => {
          if (entry.kind !== 'correction') return;
          const before = entries[index - 1];
          expect(before?.kind).not.toBe('correction');
          if (before === undefined || before.kind === 'correction') return;
          expect(before.event.eventId).toBe(entry.target.eventId);
          expect(before.standing).toBe(false);
        });
      }),
      { numRuns: 200 },
    );
  });

  it('shows the score after each standing goal, ending at the match score', () => {
    fc.assert(
      fc.property(fc.array(step, { maxLength: 30 }), (steps) => {
        const log = sessionFrom(steps);
        const entries = timeline(TEAM_IDS, log);
        const tally = TEAM_IDS.map(() => 0);
        for (const entry of entries) {
          if (entry.kind !== 'goal') continue;
          if (!entry.standing) {
            expect(entry.scoreAfter).toBeNull();
            continue;
          }
          tally[TEAM_IDS.indexOf(entry.event.teamId)] += 1;
          expect(entry.scoreAfter).toEqual(tally);
        }

        const standing = entries.flatMap((entry) => (entry.kind === 'goal' && entry.standing ? [entry.event] : []));
        expect(tally).toEqual(TEAM_IDS.map((teamId) => standing.filter((goal) => goal.teamId === teamId).length));
      }),
      { numRuns: 200 },
    );
  });

  it('pairs a corrected goal with its replacement, at the original minute', () => {
    fc.assert(
      fc.property(
        fc.array(step, { maxLength: 20 }),
        fc.integer({ min: 0, max: 60 }),
        fc.integer({ min: 0, max: 1 }),
        fc.boolean(),
        (steps, minute, team, ownGoal) => {
          const target: GoalEvent = {
            kind: 'goal',
            eventId: idOf(1_000),
            minute,
            teamId: TEAM_IDS[0],
            scorerId: PLAYER,
            ownGoal: false,
          };
          let next = 2_000;
          const pair = goalCorrection(target, { teamId: TEAM_IDS[team], scorerId: null, ownGoal }, 70, () => idOf(next++));
          const log: LoggedEvent[] = [
            ...sessionFrom(steps),
            { event: target, status: 'recorded' },
            ...pair.map((event): LoggedEvent => ({ event, status: 'pending' })),
          ];

          const correction = timeline(TEAM_IDS, log).find(
            (entry) => entry.kind === 'correction' && entry.target.eventId === target.eventId,
          );
          expect(correction).toEqual(expect.objectContaining({ replacement: pair[1], pending: true }));
          expect(pair[1].minute).toBe(minute);
          expect(pair[0]).toEqual(expect.objectContaining({ kind: 'goal-undo', targetEventId: target.eventId, minute: 70 }));
        },
      ),
      { numRuns: 100 },
    );
  });

  it('shows a goal removed outright as a correction with no replacement', () => {
    const goal: GoalEvent = { kind: 'goal', eventId: idOf(1), minute: 9, teamId: TEAM_IDS[1], scorerId: null, ownGoal: false };
    const entries = timeline(TEAM_IDS, [
      { event: goal, status: 'recorded' },
      { event: { kind: 'goal-undo', eventId: idOf(2), minute: 11, targetEventId: goal.eventId }, status: 'recorded' },
      { event: { kind: 'keeper', eventId: idOf(3), minute: 9, teamId: TEAM_IDS[0], keeperId: PLAYER }, status: 'recorded' },
    ]);

    expect(entries.map((entry) => entry.kind)).toEqual(['goal', 'correction', 'keeper']);
    expect(entries[1]).toEqual(expect.objectContaining({ replacement: null }));
  });
});
