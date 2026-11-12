/**
 * The live tracker's rules, over generated sessions:
 *
 * - the match minute is the whole minutes since kickoff, within the range the
 *   backend accepts;
 * - settling a batch changes only the pending events it names;
 * - the score shown is always the server's score once every event is recorded,
 *   counts each pending goal and undo exactly once before then, and never
 *   shows a team below 0;
 * - the scorer list is the scoring team's players (or, for an own goal, the
 *   others'), each once, likeliest first.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { teamSheet } from '../testing/matchesFixtures';
import {
  MATCH_MINUTE_MAX,
  appendEvent,
  clockText,
  currentKeepers,
  displayedScores,
  lastStandingGoal,
  matchMinute,
  mergeServerLog,
  pendingEvents,
  scorerChoices,
  settleEvents,
  standingGoals,
  type LoggedEvent,
  type TrackedEvent,
} from './liveTracking';
import type { TeamScore } from './parse/matchDetail';

const SHEET = teamSheet();
const TEAM_IDS = SHEET.teams.map(({ teamId }) => teamId);

describe('the match clock', () => {
  it('reads whole minutes since kickoff, clamped to the accepted range', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 40 }), fc.integer({ min: -10_000_000, max: 20_000_000 }), (start, offset) => {
        const minute = matchMinute(start, start + offset);
        expect(Number.isInteger(minute)).toBe(true);
        expect(minute).toBeGreaterThanOrEqual(0);
        expect(minute).toBeLessThanOrEqual(MATCH_MINUTE_MAX);
        if (offset >= 0 && offset < MATCH_MINUTE_MAX * 60_000) {
          expect(minute).toBe(Math.floor(offset / 60_000));
        }
      }),
    );
  });

  it('shows minutes and seconds, never negative', () => {
    expect(clockText(0, 32 * 60_000 + 7_000)).toBe('32:07');
    expect(clockText(10_000, 0)).toBe('00:00');
  });
});

/** One step of a session: a goal, or an undo of the latest standing goal. */
type Step = { readonly kind: 'goal'; readonly team: number } | { readonly kind: 'undo' };

const stepArb: fc.Arbitrary<Step> = fc.oneof(
  fc.record({ kind: fc.constant('goal' as const), team: fc.integer({ min: 0, max: 1 }) }),
  fc.constant({ kind: 'undo' as const }),
);

/** Play the steps into a log, every event pending, as the tracker would. */
function play(steps: readonly Step[]): readonly LoggedEvent[] {
  let log: readonly LoggedEvent[] = [];
  steps.forEach((step, index) => {
    const eventId = `0198e2a7-9999-7a5e-9c2f-${index.toString(16).padStart(12, '0')}`;
    if (step.kind === 'goal') {
      log = appendEvent(log, { kind: 'goal', eventId, minute: index, teamId: TEAM_IDS[step.team], scorerId: null, ownGoal: false });
    } else {
      const target = lastStandingGoal(log);
      if (target !== null) {
        log = appendEvent(log, { kind: 'goal-undo', eventId, minute: index, targetEventId: target.eventId });
      }
    }
  });
  return log;
}

/** What the server's running score would be once it has recorded `events`. */
function serverScoreOf(events: readonly TrackedEvent[]): readonly TeamScore[] {
  const recorded: readonly LoggedEvent[] = events.map((event) => ({ event, status: 'recorded' }));
  const scores = new Map(TEAM_IDS.map((teamId) => [teamId, 0]));
  for (const goal of standingGoals(recorded)) scores.set(goal.teamId, (scores.get(goal.teamId) ?? 0) + 1);
  return TEAM_IDS.map((teamId) => ({ teamId, score: scores.get(teamId) ?? 0 }));
}

describe('settleEvents', () => {
  it('records applied and duplicate events, drops rejected ones, and leaves the rest pending', () => {
    fc.assert(
      fc.property(fc.array(stepArb, { maxLength: 20 }), fc.array(fc.constantFrom('Applied', 'Duplicate', 'Rejected', null)), (steps, verdicts) => {
        const log = play(steps);
        const results = log.flatMap(({ event }, index) => {
          const verdict = verdicts[index] ?? null;
          return verdict === null ? [] : [{ eventId: event.eventId, outcome: verdict }];
        });

        const settled = settleEvents(log, results);
        settled.forEach((entry, index) => {
          const verdict = verdicts[index] ?? null;
          expect(entry.event).toBe(log[index].event);
          expect(entry.status).toBe(verdict === null ? 'pending' : verdict === 'Rejected' ? 'rejected' : 'recorded');
        });
      }),
    );
  });
});

describe('displayedScores', () => {
  it('is the server score once every event is recorded, whichever were recorded first', () => {
    fc.assert(
      fc.property(fc.array(stepArb, { maxLength: 24 }), fc.nat(), (steps, cut) => {
        const log = play(steps);
        const split = log.length === 0 ? 0 : cut % (log.length + 1);

        // The server has the first `split` events; the rest are still pending here.
        const sent = log.slice(0, split).map(({ event }) => event);
        const partly = settleEvents(log, sent.map(({ eventId }) => ({ eventId, outcome: 'Applied' as const })));
        const everything = log.map(({ event }) => event);

        expect(displayedScores(SHEET, serverScoreOf(sent), partly)).toEqual(serverScoreOf(everything));
      }),
    );
  });

  it('never shows a team below 0, whatever the server says', () => {
    fc.assert(
      fc.property(fc.array(stepArb, { maxLength: 24 }), fc.array(fc.nat({ max: 5 }), { minLength: 2, maxLength: 2 }), (steps, server) => {
        const log = play(steps);
        const shown = displayedScores(SHEET, TEAM_IDS.map((teamId, index) => ({ teamId, score: server[index] })), log);
        expect(shown.map(({ teamId }) => teamId)).toEqual(TEAM_IDS);
        for (const { score } of shown) expect(score).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  it('sends only what is pending', () => {
    fc.assert(
      fc.property(fc.array(stepArb, { maxLength: 20 }), (steps) => {
        const log = play(steps);
        expect(pendingEvents(log)).toEqual(log.map(({ event }) => event));
        const recorded = settleEvents(log, log.map(({ event }) => ({ eventId: event.eventId, outcome: 'Applied' as const })));
        expect(pendingEvents(recorded)).toEqual([]);
      }),
    );
  });
});

describe('mergeServerLog', () => {
  it('puts the server\'s events first, recorded, then the session\'s it lacks, each once', () => {
    fc.assert(
      fc.property(fc.array(stepArb, { maxLength: 20 }), fc.nat(), (steps, cut) => {
        const everything = play(steps);
        const split = everything.length === 0 ? 0 : cut % (everything.length + 1);
        const server = everything.slice(0, split).map(({ event }) => event);

        // The session holds everything still pending, some of which the server already has.
        const merged = mergeServerLog(everything, server);

        expect(merged.map(({ event }) => event.eventId)).toEqual(everything.map(({ event }) => event.eventId));
        merged.forEach((entry, index) => expect(entry.status).toBe(index < split ? 'recorded' : 'pending'));
      }),
    );
  });

  it('starts an empty session from the server\'s log alone', () => {
    const server: TrackedEvent[] = [
      { kind: 'goal', eventId: 'a', minute: 1, teamId: TEAM_IDS[0], scorerId: null, ownGoal: false },
    ];
    expect(mergeServerLog([], server)).toEqual([{ event: server[0], status: 'recorded' }]);
  });
});

describe('currentKeepers', () => {
  it('keeps the latest stint that stands for each team', () => {
    const [red, blue] = TEAM_IDS;
    const log: readonly LoggedEvent[] = [
      { kind: 'keeper', eventId: 's1', minute: 0, teamId: red, keeperId: 'leo' },
      { kind: 'keeper', eventId: 's2', minute: 0, teamId: blue, keeperId: 'tom' },
      { kind: 'keeper', eventId: 's3', minute: 30, teamId: red, keeperId: 'mike' },
      { kind: 'keeper-undo', eventId: 'u1', minute: 31, targetEventId: 's3' },
    ].map((event) => ({ event: event as TrackedEvent, status: 'recorded' as const }));

    expect(currentKeepers(log)).toEqual(new Map([[red, 'leo'], [blue, 'tom']]));
  });
});

describe('scorerChoices', () => {
  it('lists the scoring team for a goal and the others for an own goal, each player once', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1 }), fc.boolean(), fc.array(fc.integer({ min: 0, max: 9 }), { maxLength: 12 }), (team, ownGoal, scorers) => {
        const teamId = TEAM_IDS[team];
        let log: readonly LoggedEvent[] = [];
        scorers.forEach((player, index) => {
          const scorer = SHEET.teams.flatMap((t) => t.roster)[player];
          const scoringTeam = SHEET.teams.find((t) => t.roster.includes(scorer))!.teamId;
          log = appendEvent(log, {
            kind: 'goal',
            eventId: `0198e2a7-8888-7a5e-9c2f-${index.toString(16).padStart(12, '0')}`,
            minute: index,
            teamId: scoringTeam,
            scorerId: scorer.membershipId,
            ownGoal: false,
          });
        });

        const choices = scorerChoices(SHEET, teamId, ownGoal, log);
        const pool = SHEET.teams.filter((t) => (ownGoal ? t.teamId !== teamId : t.teamId === teamId)).flatMap((t) => t.roster);

        expect([...choices].sort((a, b) => a.membershipId.localeCompare(b.membershipId))).toEqual(
          [...pool].sort((a, b) => a.membershipId.localeCompare(b.membershipId)),
        );

        const goals = (id: string) => scorers.filter((player) => SHEET.teams.flatMap((t) => t.roster)[player].membershipId === id).length;
        for (let index = 1; index < choices.length; index += 1) {
          expect(goals(choices[index - 1].membershipId)).toBeGreaterThanOrEqual(goals(choices[index].membershipId));
        }
      }),
    );
  });
});
