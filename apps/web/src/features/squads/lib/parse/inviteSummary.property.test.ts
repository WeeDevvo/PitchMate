import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { INVITE_STATE_CODES, inviteStateFromCode } from '../enumCodes';
import { isSquadIdentifier } from '../identifiers';
import { MAX_INSTANT_MS, readInstantMs, type ParseResult } from './primitives';
import {
  parseInviteSummary,
  parseInviteSummaryList,
  type InviteSummary,
} from './inviteSummary';

/**
 * Property test for the `ListInvites` body shape, placed beside the module it covers
 * as the design's Testing Strategy asks and running well above the 100-iteration
 * floor (20.1).
 *
 * This file carries **Property 35** for `inviteSummary.ts`: for any value supplied
 * as a response body — absent, `null`, a primitive of every type, an array, an
 * object with each required field missing, an object with each field mistyped, an
 * enum field carrying a code the Enum_Code_Map does not name, and a value nested a
 * hundred levels deep — both parsers yield exactly one of a fully populated value
 * and a parse failure, and raise nothing (16.4, 16.6).
 *
 * Three field decisions of this shape are what the assertions target.
 *
 * **`state` is required and its code must be named.** The Invite_Manager renders a
 * revoke control only on an `active` invite, so a defaulted state could offer
 * revocation on an invite that is already revoked — or hide it from one that is
 * live. `4` and `0` are the near misses of this three-entry table; `3` is *in* range
 * here, which is exactly why the code the task names is generated as an in-range
 * value for this table and out-of-range for others.
 *
 * **`createdAt` is required**, because the Invite_Order sorts by it (11.3). An
 * invented instant would silently reorder the list, so `null`, absent, and every
 * malformed form must fail the summary.
 *
 * **`createdBy` is a free-form optional string, not an identity.** The backend
 * stamps it from its audit actor and documents `null` for a system operation, so the
 * generators feed arbitrary non-identity strings and each must parse — reading it as
 * a UUID would fail bodies the backend legitimately sends.
 *
 * An invite summary carries nothing from which the redeemable secret could be
 * reconstructed, and the reason assertions keep that true for failures too.
 *
 * Requirements: 11.3, 16.4, 16.6, 20.10
 */

/* -------------------------------------------------------------------------- */
/* The totality harness                                                       */
/* -------------------------------------------------------------------------- */

/** A value's own keys, sorted, as a comparable string. */
function keySignature(value: object): string {
  return Object.keys(value).sort().join(',');
}

/**
 * Settles one parse and asserts Property 35's frame: no exception, exactly one of
 * the two result shapes with exactly its own fields, a fully populated value on
 * success, and a non-empty diagnostic reason on failure.
 */
function settle<T>(
  parse: () => ParseResult<T>,
  isFullyPopulated: (value: T) => boolean,
): ParseResult<T> {
  let outcome: ParseResult<T>;

  try {
    outcome = parse();
  } catch (raised) {
    // 16.4: the parser raises nothing, for any input at all.
    throw new Error(`the parser raised instead of failing: ${String(raised)}`, {
      cause: raised,
    });
  }

  expect(typeof outcome).toBe('object');
  expect(outcome).not.toBeNull();
  expect(typeof outcome.ok).toBe('boolean');

  if (outcome.ok) {
    expect(keySignature(outcome)).toBe('ok,value');
    expect(isFullyPopulated(outcome.value)).toBe(true);
  } else {
    expect(keySignature(outcome)).toBe('ok,reason');
    expect(typeof outcome.reason).toBe('string');
    expect(outcome.reason.length).toBeGreaterThan(0);
  }

  return outcome;
}

/* -------------------------------------------------------------------------- */
/* Generators over the whole input space                                      */
/* -------------------------------------------------------------------------- */

/** A well-formed identity, for the generators that need one to spoil. */
const WELL_FORMED_IDENTITY = '018f3a2b-4c5d-7e6f-8a9b-0c1d2e3f4a5b';

/** Values of every primitive type, together with the two absences. */
const primitiveArb: fc.Arbitrary<unknown> = fc.oneof(
  {
    weight: 8,
    arbitrary: fc.constantFrom<unknown>(
      undefined,
      null,
      true,
      false,
      0,
      -0,
      1,
      2,
      3,
      4,
      0.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      1_700_000_000_000,
      '',
      ' ',
      '0',
      '1',
      '3',
      'active',
      'expired',
      '{}',
      WELL_FORMED_IDENTITY,
      '2026-01-01T00:00:00Z',
      '2026-01-01T00:00:00',
      0n,
      Symbol('wire'),
    ),
  },
  { weight: 2, arbitrary: fc.string({ maxLength: 32 }) },
  { weight: 2, arbitrary: fc.double() },
  { weight: 1, arbitrary: fc.integer({ min: -4, max: 8 }) },
  { weight: 1, arbitrary: fc.boolean() },
);

/** Arrays, plain objects, and the exotic object shapes a body could carry. */
const structuralArb: fc.Arbitrary<unknown> = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.constantFrom<unknown>(
      [],
      [{}],
      [[]],
      {},
      { inviteId: WELL_FORMED_IDENTITY },
      Object.create(null),
      new Date(0),
      new Map<unknown, unknown>([['state', 1]]),
      new Set<unknown>([1]),
      () => ({}),
      Object(1),
      Object('a'),
    ),
  },
  { weight: 3, arbitrary: fc.array(primitiveArb, { maxLength: 4 }) },
  {
    weight: 3,
    arbitrary: fc.dictionary(fc.string({ maxLength: 8 }), primitiveArb, {
      maxKeys: 5,
    }),
  },
  {
    weight: 3,
    arbitrary: fc.anything({
      maxDepth: 3,
      withBigInt: true,
      withDate: true,
      withMap: true,
      withSet: true,
      withNullPrototype: true,
      withObjectString: true,
    }),
  },
);

/** The whole input space Property 35 quantifies over. */
const anyBodyArb: fc.Arbitrary<unknown> = fc.oneof(
  { weight: 4, arbitrary: primitiveArb },
  { weight: 5, arbitrary: structuralArb },
);

/** Wraps `leaf` in `depth` levels of alternating arrays and objects. */
function nest(leaf: unknown, depth: number): unknown {
  let value: unknown = leaf;

  for (let level = 0; level < depth; level += 1) {
    value = level % 2 === 0 ? [value] : { value };
  }

  return value;
}

/** A value nested to between 1 and 100 levels. */
const deeplyNestedArb: fc.Arbitrary<unknown> = fc
  .tuple(primitiveArb, fc.integer({ min: 1, max: 100 }))
  .map(([leaf, depth]) => nest(leaf, depth));

/* -------------------------------------------------------------------------- */
/* Field-level generators                                                     */
/* -------------------------------------------------------------------------- */

/** Well-formed identities, including the two extremes of the form. */
const identityArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 3, arbitrary: fc.uuid() },
  {
    weight: 1,
    arbitrary: fc.constantFrom(
      WELL_FORMED_IDENTITY,
      WELL_FORMED_IDENTITY.toUpperCase(),
      '00000000-0000-0000-0000-000000000000',
      'ffffffff-ffff-ffff-ffff-ffffffffffff',
    ),
  },
);

/** Instant strings the reader accepts, in each of the forms it accepts. */
const instantTextArb: fc.Arbitrary<string> = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.constantFrom(
      '1970-01-01T00:00:00Z',
      '2026-01-01T00:00:00Z',
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00Z',
      '2026-01-01T01:00:00+01:00',
      '2026-01-01T01:00:00+0100',
      '2026-01-01T01:00:00+01',
      '2024-02-29T23:59:59.999Z',
      '+002026-01-01T00:00:00Z',
    ),
  },
  {
    weight: 2,
    arbitrary: fc
      .integer({ min: -62_000_000_000_000, max: 253_000_000_000_000 })
      .map((instantMs) => new Date(instantMs).toISOString()),
  },
);

/**
 * Audit actor strings, deliberately including values that are *not* identities: the
 * backend stamps this from its own actor, so reading it as a UUID would fail bodies
 * it legitimately sends.
 */
const createdByArb: fc.Arbitrary<string> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.constantFrom(
      '',
      ' ',
      'system',
      'admin@example.test',
      'Dave',
      WELL_FORMED_IDENTITY,
      'x'.repeat(256),
    ),
  },
  { weight: 2, arbitrary: fc.string({ maxLength: 40 }) },
);

/** Values no identity field accepts, including the near misses of the form. */
const notAnIdentityArb: fc.Arbitrary<unknown> = fc.oneof(
  {
    weight: 5,
    arbitrary: fc.constantFrom<unknown>(
      undefined,
      null,
      '',
      ' ',
      0,
      1,
      true,
      WELL_FORMED_IDENTITY.replace(/-/g, ''),
      `{${WELL_FORMED_IDENTITY}}`,
      ` ${WELL_FORMED_IDENTITY}`,
      `${WELL_FORMED_IDENTITY} `,
      WELL_FORMED_IDENTITY.slice(0, 35),
      `${WELL_FORMED_IDENTITY}b`,
      [WELL_FORMED_IDENTITY],
      { inviteId: WELL_FORMED_IDENTITY },
    ),
  },
  { weight: 3, arbitrary: anyBodyArb.filter((value) => !isSquadIdentifier(value)) },
);

/**
 * Values no Invite_State code names, the absences included — this state is
 * required, so `null` and an absent property are contract mismatches.
 *
 * `0` and `4` are the near misses either side of this 1-based three-entry table.
 * `3` is deliberately absent from this list: it names `expired` here, which is why
 * the same code appears in the *unnamed* generators of the two-entry tables.
 */
const unnamedInviteStateArb: fc.Arbitrary<unknown> = fc.oneof(
  {
    weight: 5,
    arbitrary: fc.constantFrom<unknown>(
      undefined,
      null,
      0,
      -0,
      4,
      5,
      -1,
      1.5,
      2.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      '1',
      '3',
      'active',
      'expired',
      true,
      false,
      [1],
      { state: 1 },
      3n,
    ),
  },
  {
    weight: 2,
    arbitrary: anyBodyArb.filter((value) => inviteStateFromCode(value) === undefined),
  },
);

/** Values that name no instant, the absences included — `createdAt` is required. */
const notARequiredInstantArb: fc.Arbitrary<unknown> = fc.oneof(
  {
    weight: 5,
    arbitrary: fc.constantFrom<unknown>(
      undefined,
      null,
      '',
      ' ',
      0,
      1_700_000_000_000,
      true,
      '2026-01-01',
      '2026-01-01T00:00:00',
      '2026-02-30T00:00:00Z',
      '2026-13-01T00:00:00Z',
      '2026-01-01T24:00:00Z',
      '2026-01-01T00:00:00+24:00',
      '2023-02-29T00:00:00Z',
      ' 2026-01-01T00:00:00Z',
      '+275760-09-14T00:00:00Z',
      ['2026-01-01T00:00:00Z'],
      { createdAt: '2026-01-01T00:00:00Z' },
    ),
  },
  {
    weight: 2,
    arbitrary: anyBodyArb.filter((value) => !readInstantMs(value, 'field').ok),
  },
);

/** Present values that name no instant, for the optional expiry. */
const notAPresentInstantArb: fc.Arbitrary<unknown> = notARequiredInstantArb.filter(
  (value) => value !== null && value !== undefined,
);

/** Values no optional string field accepts once present. */
const notAPresentStringArb: fc.Arbitrary<unknown> = fc.oneof(
  {
    weight: 5,
    arbitrary: fc.constantFrom<unknown>(
      0,
      1,
      true,
      false,
      Number.NaN,
      [],
      ['a'],
      {},
      { createdBy: 'a' },
      Object('a'),
      0n,
      Symbol('a'),
    ),
  },
  {
    weight: 3,
    arbitrary: anyBodyArb.filter(
      (value) =>
        value !== null && value !== undefined && typeof value !== 'string',
    ),
  },
);

/* -------------------------------------------------------------------------- */
/* Well-formed bodies, and what a populated value must look like              */
/* -------------------------------------------------------------------------- */

/** The named Invite_State codes, read from the Enum_Code_Map itself. */
const NAMED_INVITE_STATE_CODES: readonly number[] = Object.keys(
  INVITE_STATE_CODES,
).map(Number);

/** The invite-state names the Enum_Code_Map carries. */
const INVITE_STATE_NAMES: readonly string[] = Object.values(INVITE_STATE_CODES);

/**
 * A well-formed `ListInvites` element, generated across the three forms each of the
 * two optional fields may take — present, explicit `null`, and absent.
 */
const wellFormedArb: fc.Arbitrary<Record<string, unknown>> = fc
  .record({
    inviteId: identityArb,
    state: fc.constantFrom(...NAMED_INVITE_STATE_CODES),
    createdAt: instantTextArb,
    createdBy: fc.oneof(
      { weight: 3, arbitrary: createdByArb as fc.Arbitrary<unknown> },
      { weight: 1, arbitrary: fc.constant<unknown>(null) },
    ),
    expiresAt: fc.oneof(
      { weight: 3, arbitrary: instantTextArb as fc.Arbitrary<unknown> },
      { weight: 1, arbitrary: fc.constant<unknown>(null) },
    ),
    dropCreatedBy: fc.boolean(),
    dropExpiry: fc.boolean(),
  })
  .map(
    ({
      inviteId,
      state,
      createdAt,
      createdBy,
      expiresAt,
      dropCreatedBy,
      dropExpiry,
    }) => {
      const body: Record<string, unknown> = { inviteId, state, createdAt };

      if (!dropCreatedBy) {
        body.createdBy = createdBy;
      }

      if (!dropExpiry) {
        body.expiresAt = expiresAt;
      }

      return body;
    },
  );

/** Every field this shape declares, by its wire name. */
const FIELDS = [
  'inviteId',
  'state',
  'createdAt',
  'createdBy',
  'expiresAt',
] as const;

/**
 * Whether a parsed Invite_Summary is fully populated: exactly the five declared
 * fields, each of its declared type, with no field left `undefined`.
 */
function isFullyPopulatedSummary(summary: InviteSummary): boolean {
  const isInstant = (value: number): boolean =>
    typeof value === 'number' &&
    Number.isInteger(value) &&
    Math.abs(value) <= MAX_INSTANT_MS;

  return (
    keySignature(summary) === 'createdAtMs,createdBy,expiresAtMs,inviteId,state' &&
    isSquadIdentifier(summary.inviteId) &&
    INVITE_STATE_NAMES.includes(summary.state) &&
    isInstant(summary.createdAtMs) &&
    (summary.createdBy === null || typeof summary.createdBy === 'string') &&
    (summary.expiresAtMs === null || isInstant(summary.expiresAtMs))
  );
}

/** Whether a parsed listing is fully populated in every element. */
function isFullyPopulatedList(summaries: readonly InviteSummary[]): boolean {
  return Array.isArray(summaries) && summaries.every(isFullyPopulatedSummary);
}

/** `body` without `key`. */
function without(
  body: Readonly<Record<string, unknown>>,
  key: string,
): Record<string, unknown> {
  const copy = { ...body };

  delete copy[key];

  return copy;
}

/** `body` with `key` defined as an accessor that throws when it is read. */
function throwingAt(
  body: Readonly<Record<string, unknown>>,
  key: string,
): Record<string, unknown> {
  return Object.defineProperty({ ...body }, key, {
    enumerable: true,
    configurable: true,
    get(): never {
      throw new Error('a throwing accessor');
    },
  });
}

/* -------------------------------------------------------------------------- */
/* One summary                                                                */
/* -------------------------------------------------------------------------- */

// Feature: web-squads-screens, Property 35: Every response parser is total and never yields a partial value
// Validates: Requirements 11.3, 16.4, 16.6, 20.10
describe('parseInviteSummary — total, and never partial', () => {
  it('settles every input into exactly one of a populated value and a failure', () => {
    fc.assert(
      fc.property(anyBodyArb, (body) => {
        settle(() => parseInviteSummary(body), isFullyPopulatedSummary);
      }),
      { numRuns: 1000 },
    );
  });

  it('settles a value nested to 100 levels', () => {
    fc.assert(
      fc.property(deeplyNestedArb, (body) => {
        const outcome = settle(
          () => parseInviteSummary(body),
          isFullyPopulatedSummary,
        );

        expect(outcome.ok).toBe(false);
      }),
      { numRuns: 300 },
    );
  });

  it('settles a well-formed body whose every field is 100 levels deep', () => {
    fc.assert(
      fc.property(
        wellFormedArb,
        fc.constantFrom(...FIELDS),
        deeplyNestedArb,
        (body, key, deep) => {
          const outcome = settle(
            () => parseInviteSummary({ ...body, [key]: deep }),
            isFullyPopulatedSummary,
          );

          expect(outcome.ok).toBe(false);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('parses every well-formed body into a fully populated value', () => {
    fc.assert(
      fc.property(wellFormedArb, (body) => {
        const outcome = settle(
          () => parseInviteSummary(body),
          isFullyPopulatedSummary,
        );

        expect(outcome.ok).toBe(true);

        if (outcome.ok) {
          expect(outcome.value.inviteId).toBe(body.inviteId);
          expect(outcome.value.state).toBe(inviteStateFromCode(body.state));

          const createdAt = readInstantMs(body.createdAt, 'createdAt');

          expect(outcome.value.createdAtMs).toBe(createdAt.ok ? createdAt.value : null);
          // `null` and absent are the same absence, for both optional fields.
          expect(outcome.value.createdBy).toBe(
            body.createdBy === null || body.createdBy === undefined
              ? null
              : body.createdBy,
          );

          if (body.expiresAt === null || body.expiresAt === undefined) {
            expect(outcome.value.expiresAtMs).toBeNull();
          } else {
            const expiresAt = readInstantMs(body.expiresAt, 'expiresAt');

            expect(outcome.value.expiresAtMs).toBe(
              expiresAt.ok ? expiresAt.value : null,
            );
          }
        }
      }),
      { numRuns: 500 },
    );
  });

  it('fails when a required field is absent', () => {
    fc.assert(
      fc.property(
        wellFormedArb,
        fc.constantFrom('inviteId', 'state', 'createdAt'),
        (body, key) => {
          const outcome = settle(
            () => parseInviteSummary(without(body, key)),
            isFullyPopulatedSummary,
          );

          // A defaulted state could offer revocation on a revoked invite, and an
          // invented creation instant would silently reorder the list (11.3).
          expect(outcome.ok).toBe(false);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('fails when the state names nothing, 0 and 4 included', () => {
    fc.assert(
      fc.property(wellFormedArb, unnamedInviteStateArb, (body, state) => {
        const outcome = settle(
          () => parseInviteSummary({ ...body, state }),
          isFullyPopulatedSummary,
        );

        expect(outcome.ok).toBe(false);
      }),
      { numRuns: 500 },
    );
  });

  it('names each of the three states the backend declares', () => {
    fc.assert(
      fc.property(
        wellFormedArb,
        fc.constantFrom(...NAMED_INVITE_STATE_CODES),
        (body, state) => {
          const outcome = settle(
            () => parseInviteSummary({ ...body, state }),
            isFullyPopulatedSummary,
          );

          // `expired` is derived by the backend clock and arrives like any other
          // state, so `3` is in range here and this feature does no expiry
          // arithmetic of its own.
          expect(outcome.ok).toBe(true);
          expect(outcome.ok && outcome.value.state).toBe(inviteStateFromCode(state));
        },
      ),
      { numRuns: 300 },
    );
  });

  it('fails when the creation instant is absent, null, or malformed', () => {
    fc.assert(
      fc.property(wellFormedArb, notARequiredInstantArb, (body, createdAt) => {
        const outcome = settle(
          () => parseInviteSummary({ ...body, createdAt }),
          isFullyPopulatedSummary,
        );

        expect(outcome.ok).toBe(false);
      }),
      { numRuns: 500 },
    );
  });

  it('fails when the identity is mistyped', () => {
    fc.assert(
      fc.property(wellFormedArb, notAnIdentityArb, (body, inviteId) => {
        const outcome = settle(
          () => parseInviteSummary({ ...body, inviteId }),
          isFullyPopulatedSummary,
        );

        expect(outcome.ok).toBe(false);
      }),
      { numRuns: 500 },
    );
  });

  it('parses an absent or null createdBy and expiry as absences', () => {
    fc.assert(
      fc.property(
        identityArb,
        fc.constantFrom(...NAMED_INVITE_STATE_CODES),
        instantTextArb,
        fc.constantFrom('present-null', 'present-undefined', 'absent'),
        fc.constantFrom('present-null', 'present-undefined', 'absent'),
        (inviteId, state, createdAt, actorForm, expiryForm) => {
          const body: Record<string, unknown> = { inviteId, state, createdAt };

          if (actorForm === 'present-null') {
            body.createdBy = null;
          } else if (actorForm === 'present-undefined') {
            body.createdBy = undefined;
          }

          if (expiryForm === 'present-null') {
            body.expiresAt = null;
          } else if (expiryForm === 'present-undefined') {
            body.expiresAt = undefined;
          }

          const outcome = settle(
            () => parseInviteSummary(body),
            isFullyPopulatedSummary,
          );

          // `null` createdBy is a system operation; `null` expiry is an invite that
          // does not expire. Both are meaningful absences, not missing values.
          expect(outcome.ok).toBe(true);
          expect(outcome.ok && outcome.value.createdBy).toBeNull();
          expect(outcome.ok && outcome.value.expiresAtMs).toBeNull();
        },
      ),
      { numRuns: 300 },
    );
  });

  it('accepts any string as the audit actor, identity-shaped or not', () => {
    fc.assert(
      fc.property(
        identityArb,
        fc.constantFrom(...NAMED_INVITE_STATE_CODES),
        instantTextArb,
        createdByArb,
        (inviteId, state, createdAt, createdBy) => {
          const outcome = settle(
            () => parseInviteSummary({ inviteId, state, createdAt, createdBy }),
            isFullyPopulatedSummary,
          );

          // Reading this as a UUID would fail bodies the backend legitimately
          // sends, `'system'` among them.
          expect(outcome.ok).toBe(true);
          expect(outcome.ok && outcome.value.createdBy).toBe(createdBy);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('fails when a present optional field is mistyped', () => {
    fc.assert(
      fc.property(
        wellFormedArb,
        fc.oneof(
          fc.tuple(fc.constant('createdBy'), notAPresentStringArb),
          fc.tuple(fc.constant('expiresAt'), notAPresentInstantArb),
        ),
        (body, [key, value]) => {
          const outcome = settle(
            () => parseInviteSummary({ ...body, [key]: value }),
            isFullyPopulatedSummary,
          );

          // Optional means absent-or-valid, never unvalidated.
          expect(outcome.ok).toBe(false);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('fails rather than raising when a named field throws on read', () => {
    fc.assert(
      fc.property(wellFormedArb, fc.constantFrom(...FIELDS), (body, key) => {
        const outcome = settle(
          () => parseInviteSummary(throwingAt(body, key)),
          isFullyPopulatedSummary,
        );

        // Only the two optional fields tolerate an absence.
        expect(outcome.ok).toBe(key === 'createdBy' || key === 'expiresAt');
      }),
      { numRuns: 300 },
    );
  });

  it('is deterministic, so no reading depends on a clock or a counter', () => {
    fc.assert(
      fc.property(fc.oneof(anyBodyArb, wellFormedArb), (body) => {
        expect(parseInviteSummary(body)).toEqual(parseInviteSummary(body));
      }),
      { numRuns: 400 },
    );
  });

  it('composes its reason from field labels and never from the value', () => {
    fc.assert(
      fc.property(
        wellFormedArb,
        fc.constantFrom('SUPER-SECRET-TOKEN', 'admin@example.test'),
        (body, sensitive) => {
          const outcome = settle(
            () => parseInviteSummary({ ...body, createdBy: [sensitive] }),
            isFullyPopulatedSummary,
          );

          expect(outcome.ok).toBe(false);

          if (!outcome.ok) {
            expect(outcome.reason).not.toContain(sensitive);
            expect(outcome.reason).toContain('createdBy');
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* The whole listing                                                          */
/* -------------------------------------------------------------------------- */

// Feature: web-squads-screens, Property 35: Every response parser is total and never yields a partial value
// Validates: Requirements 16.4, 16.6, 20.10
describe('parseInviteSummaryList — total, and complete or failed', () => {
  it('settles every input into exactly one of a populated value and a failure', () => {
    fc.assert(
      fc.property(anyBodyArb, (body) => {
        settle(() => parseInviteSummaryList(body), isFullyPopulatedList);
      }),
      { numRuns: 1000 },
    );
  });

  it('settles a value nested to 100 levels', () => {
    fc.assert(
      fc.property(deeplyNestedArb, (body) => {
        settle(() => parseInviteSummaryList(body), isFullyPopulatedList);
      }),
      { numRuns: 300 },
    );
  });

  it('parses a listing of any length into one populated value per element', () => {
    fc.assert(
      fc.property(fc.array(wellFormedArb, { maxLength: 30 }), (elements) => {
        const outcome = settle(
          () => parseInviteSummaryList(elements),
          isFullyPopulatedList,
        );

        expect(outcome.ok).toBe(true);
        expect(outcome.ok && outcome.value).toHaveLength(elements.length);
      }),
      { numRuns: 300 },
    );
  });

  it('fails the whole body when any one element is bad', () => {
    fc.assert(
      fc.property(
        fc.array(wellFormedArb, { minLength: 1, maxLength: 8 }),
        fc.nat(),
        fc.oneof(
          anyBodyArb,
          wellFormedArb.map((body) => without(body, 'createdAt')),
        ),
        (elements, offset, spoiled) => {
          const index = offset % elements.length;
          const body: unknown[] = [...elements];
          body[index] = spoiled;

          const outcome = settle(
            () => parseInviteSummaryList(body),
            isFullyPopulatedList,
          );

          // An invite quietly dropped is an invite an admin cannot revoke, which is
          // the outcome least worth risking on a surface about who can join.
          expect(outcome.ok).toBe(parseInviteSummary(spoiled).ok);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('fails every non-array body, an object included', () => {
    fc.assert(
      fc.property(
        anyBodyArb.filter((value) => !Array.isArray(value)),
        (body) => {
          const outcome = settle(
            () => parseInviteSummaryList(body),
            isFullyPopulatedList,
          );

          expect(outcome.ok).toBe(false);
        },
      ),
      { numRuns: 500 },
    );
  });
});
