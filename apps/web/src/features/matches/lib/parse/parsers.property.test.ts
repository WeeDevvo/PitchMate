import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  DAY_ISO,
  DAY_MS,
  MATCH_ID,
  SQUAD_ID,
  matchDetail,
  wireMatchDetail,
  wireMatchList,
  wireMatchListEntry,
  wireTally,
} from '../../testing/matchesFixtures';
import { MATCH_STATE_NAMES } from '../wireEnums';
import { parseMatchDetail } from './matchDetail';
import { parseMatchList } from './matchList';
import {
  parseAvailabilityTally,
  parseCreatedDraft,
  parseSquadStandings,
} from './responses';

const REQUIRED_DETAIL_FIELDS = [
  'matchId',
  'squadId',
  'state',
  'location',
  'candidateDays',
  'participantCount',
  'participants',
  'callerIsParticipant',
  'callerAvailability',
  'guestAvailability',
] as const;

/** A value that is wrong for every field the parsers read. */
const hostileArb = fc.oneof(
  fc.constant(undefined),
  fc.constant(null),
  fc.constant(-1.5),
  fc.constant({}),
  fc.constant([{}]),
  fc.constant(true),
);

describe('parseMatchDetail', () => {
  it('reads a contract-shaped body to the presented value', () => {
    expect(parseMatchDetail(wireMatchDetail())).toEqual({ ok: true, value: matchDetail() });
  });

  it('reads every match state by name', () => {
    for (const state of MATCH_STATE_NAMES) {
      const parsed = parseMatchDetail(wireMatchDetail({ state }));
      expect(parsed.ok && parsed.value.state).toBe(state);
    }
  });

  it('reads participants and a confirmed day', () => {
    const parsed = parseMatchDetail(
      wireMatchDetail({
        state: 'Confirmed',
        confirmedDay: '2030-03-04T19:00:00Z',
        participantCount: 1,
        participants: [
          { squadMembershipId: MATCH_ID, displayName: 'Sam', isGuest: true, rosterPosition: 0 },
        ],
      }),
    );

    expect(parsed).toEqual({
      ok: true,
      value: matchDetail({
        state: 'Confirmed',
        confirmedDayMs: DAY_MS[1],
        participantCount: 1,
        participants: [
          { membershipId: MATCH_ID, displayName: 'Sam', isGuest: true, rosterPosition: 0 },
        ],
      }),
    });
  });

  it('fails the whole body when any required field is missing or malformed', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...REQUIRED_DETAIL_FIELDS),
        hostileArb,
        (field, value) => {
          // `true` is a well-formed value for the one boolean field.
          fc.pre(!(field === 'callerIsParticipant' && typeof value === 'boolean'));
          const body: Record<string, unknown> = { ...wireMatchDetail() };
          body[field] = value;
          // Every other hostile value is wrong for every required field: `{}` lacks
          // callerAvailability's own fields, and `[{}]` holds a malformed element.
          expect(parseMatchDetail(body).ok).toBe(false);
        },
      ),
    );
  });

  it('ignores properties it does not name', () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.string().filter((key) => !(key in wireMatchDetail())),
          fc.anything(),
        ),
        (extra) => {
          expect(parseMatchDetail({ ...wireMatchDetail(), ...extra })).toEqual({
            ok: true,
            value: matchDetail(),
          });
        },
      ),
    );
  });

  it('never raises, whatever it is given', () => {
    fc.assert(
      fc.property(fc.anything(), (value) => {
        const parsed = parseMatchDetail(value);
        expect(typeof parsed.ok).toBe('boolean');
      }),
    );
  });
});

describe('parseMatchDetail guest availability', () => {
  const membershipIdArb = fc.uuid({ version: 4 });

  it('reads what was marked for each guest, in order', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({ membershipId: membershipIdArb, days: fc.subarray([0, 1, 2]) }),
          { maxLength: 6 },
        ),
        (guests) => {
          const parsed = parseMatchDetail(
            wireMatchDetail({
              guestAvailability: guests.map(({ membershipId, days }) => ({
                squadMembershipId: membershipId,
                markedDays: days.map((index) => DAY_ISO[index]!),
              })),
            }),
          );

          expect(parsed).toEqual({
            ok: true,
            value: matchDetail({
              guestAvailability: guests.map(({ membershipId, days }) => ({
                membershipId,
                markedDaysMs: days.map((index) => DAY_MS[index]!),
              })),
            }),
          });
        },
      ),
      { numRuns: 100 },
    );
  });

  it('fails the whole body for a malformed guest entry', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<unknown>(
          {},
          { squadMembershipId: 'not-a-uuid', markedDays: [] },
          { squadMembershipId: '0198e2a7-4444-7a5e-9c2f-6b1d4a5e7f01', markedDays: ['2030-03-02T20:15:00'] },
          { squadMembershipId: '0198e2a7-4444-7a5e-9c2f-6b1d4a5e7f01' },
        ),
        (entry) => {
          expect(parseMatchDetail({ ...wireMatchDetail(), guestAvailability: [entry] }).ok).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('parseMatchDetail result and completion', () => {
  const teamScores = [
    { teamId: '0198e2a7-4444-7a5e-9c2f-6b1d4a5e7f01', score: 2 },
    { teamId: '0198e2a7-4444-7a5e-9c2f-6b1d4a5e7f02', score: 2 },
  ];

  it('reads a recorded result and the completion instant', () => {
    const parsed = parseMatchDetail(
      wireMatchDetail({
        state: 'Completed',
        recordedResult: { fidelity: 'Basic', teamScores },
        completedAt: '2030-03-02T20:15:00Z',
      }),
    );

    expect(parsed).toEqual({
      ok: true,
      value: matchDetail({
        state: 'Completed',
        recordedResult: { fidelity: 'Basic', teamScores },
        completedAtMs: Date.parse('2030-03-02T20:15:00Z'),
      }),
    });
  });

  it('reads an absent result and completion as none', () => {
    const parsed = parseMatchDetail({ ...wireMatchDetail(), recordedResult: undefined, completedAt: undefined });
    expect(parsed.ok && parsed.value.recordedResult === null && parsed.value.completedAtMs === null).toBe(true);
  });

  it('fails the whole body for any malformed result or completion instant', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          hostileArb.filter((value) => value !== null && value !== undefined).map((recordedResult) => ({ recordedResult })),
          fc.constant({ recordedResult: { fidelity: 'Live', teamScores } }),
          fc.constant({ recordedResult: { fidelity: 'Basic', teamScores: [{ teamId: 'nope', score: 1 }] } }),
          fc.constant({ recordedResult: { fidelity: 'Basic', teamScores: [{ ...teamScores[0], score: -1 }] } }),
          hostileArb
            .filter((value) => value !== null && value !== undefined)
            .map((completedAt) => ({ completedAt })),
        ),
        (overrides) => {
          expect(parseMatchDetail({ ...wireMatchDetail(), ...overrides }).ok).toBe(false);
        },
      ),
    );
  });
});

describe('parseMatchList', () => {
  it('reads the entries and the truncation flag', () => {
    const parsed = parseMatchList(wireMatchList([wireMatchListEntry()], true));
    expect(parsed.ok && parsed.value.truncated).toBe(true);
    expect(parsed.ok && parsed.value.matches.map((match) => match.matchId)).toEqual([MATCH_ID]);
  });

  it('fails the whole list when one entry is malformed, rather than dropping it', () => {
    const parsed = parseMatchList(
      wireMatchList([wireMatchListEntry(), wireMatchListEntry({ state: 'Drafted' as never })]),
    );
    expect(parsed.ok).toBe(false);
  });
});

describe('parseAvailabilityTally', () => {
  it('reads each day and its count', () => {
    expect(parseAvailabilityTally(wireTally([1, 2, 3]))).toEqual({
      ok: true,
      value: DAY_MS.map((dayMs, index) => ({ dayMs, count: index + 1 })),
    });
  });

  it('reads an absent or null day list as no days', () => {
    expect(parseAvailabilityTally({})).toEqual({ ok: true, value: [] });
    expect(parseAvailabilityTally({ days: null })).toEqual({ ok: true, value: [] });
  });

  it('rejects a negative or fractional count', () => {
    for (const count of [-1, 2.5, '3']) {
      expect(
        parseAvailabilityTally({ days: [{ day: '2030-03-02T19:00:00Z', count }] }).ok,
      ).toBe(false);
    }
  });
});

describe('parseCreatedDraft and parseSquadStandings', () => {
  it('reads the created match identity', () => {
    expect(parseCreatedDraft({ matchId: MATCH_ID })).toEqual({ ok: true, value: MATCH_ID });
    expect(parseCreatedDraft({ matchId: 'nope' }).ok).toBe(false);
  });

  it('reads each squad standing and its name, with role and state optional', () => {
    expect(
      parseSquadStandings([
        { squadId: SQUAD_ID, name: 'Tuesday 5s', role: 'Admin', state: 'Active' },
        { squadId: MATCH_ID, name: 'Other', role: null, state: null },
      ]),
    ).toEqual({
      ok: true,
      value: [
        { squadId: SQUAD_ID, squadName: 'Tuesday 5s', role: 'Admin', state: 'Active' },
        { squadId: MATCH_ID, squadName: 'Other', role: null, state: null },
      ],
    });
    expect(parseSquadStandings([{ squadId: SQUAD_ID, name: 'Tuesday 5s', role: 'Captain', state: 'Active' }]).ok).toBe(
      false,
    );
  });
});
