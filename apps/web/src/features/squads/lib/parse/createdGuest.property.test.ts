import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { isSquadIdentifier } from '../identifiers';
import type { ParseResult } from './primitives';
import { parseCreatedGuest, type CreatedGuest } from './createdGuest';

/**
 * Property test for the `CreateGuest` body shape, placed beside the module it
 * covers as the design's Testing Strategy asks and running well above the
 * 100-iteration floor (20.1).
 *
 * This file carries **Property 35** for `createdGuest.ts`: for any value supplied
 * as a response body — absent, `null`, a primitive of every type, an array, an
 * object with its one field missing or mistyped, and a value nested a hundred
 * levels deep — the parser yields exactly one of a fully populated Created_Guest
 * and a parse failure, and raises nothing (16.4).
 *
 * The shape has one field and it is required. The Squad_Screen re-reads the squad
 * after a successful creation rather than splicing the guest into the rendered
 * list, so this value is read for the outcome it confirms rather than for a row it
 * fills — but "created" is still a claim this feature should only make about a
 * guest the backend actually named, which is why an absent or malformed identity
 * is a failure rather than a success with an empty field.
 *
 * The Skill_Tier code `3` the task names is a *command* input rather than a
 * response field: a created guest's body carries only the membership identity, so
 * there is no tier here to point an out-of-range code at. Property 37 covers the
 * tier table itself.
 *
 * Requirements: 16.4, 20.10
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
      3,
      0.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      '',
      ' ',
      '0',
      'null',
      '{}',
      WELL_FORMED_IDENTITY,
      0n,
      Symbol('wire'),
    ),
  },
  { weight: 2, arbitrary: fc.string({ maxLength: 40 }) },
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
      Object.create(null),
      new Date(0),
      new Map<unknown, unknown>([['guestMembershipId', WELL_FORMED_IDENTITY]]),
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
      `urn:uuid:${WELL_FORMED_IDENTITY}`,
      ` ${WELL_FORMED_IDENTITY}`,
      `${WELL_FORMED_IDENTITY} `,
      WELL_FORMED_IDENTITY.slice(0, 35),
      `${WELL_FORMED_IDENTITY}b`,
      `${WELL_FORMED_IDENTITY.slice(0, 35)}g`,
      [WELL_FORMED_IDENTITY],
      { guestMembershipId: WELL_FORMED_IDENTITY },
    ),
  },
  { weight: 3, arbitrary: anyBodyArb.filter((value) => !isSquadIdentifier(value)) },
);

/* -------------------------------------------------------------------------- */
/* Well-formed bodies, and what a populated value must look like              */
/* -------------------------------------------------------------------------- */

/** A well-formed `CreateGuest` body. */
const wellFormedArb: fc.Arbitrary<Record<string, unknown>> = fc.record({
  guestMembershipId: identityArb,
});

/**
 * Whether a parsed Created_Guest is fully populated: exactly its one declared
 * field, a well-formed identity, never left `undefined`.
 */
function isFullyPopulated(created: CreatedGuest): boolean {
  return (
    keySignature(created) === 'guestMembershipId' &&
    isSquadIdentifier(created.guestMembershipId)
  );
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

// Feature: web-squads-screens, Property 35: Every response parser is total and never yields a partial value
// Validates: Requirements 16.4, 20.10
describe('parseCreatedGuest — total, and never partial', () => {
  it('settles every input into exactly one of a populated value and a failure', () => {
    fc.assert(
      fc.property(anyBodyArb, (body) => {
        settle(() => parseCreatedGuest(body), isFullyPopulated);
      }),
      { numRuns: 1000 },
    );
  });

  it('settles a value nested to 100 levels', () => {
    fc.assert(
      fc.property(deeplyNestedArb, (body) => {
        const outcome = settle(() => parseCreatedGuest(body), isFullyPopulated);

        expect(outcome.ok).toBe(false);
      }),
      { numRuns: 300 },
    );
  });

  it('settles a body whose field is 100 levels deep', () => {
    fc.assert(
      fc.property(deeplyNestedArb, (deep) => {
        const outcome = settle(
          () => parseCreatedGuest({ guestMembershipId: deep }),
          isFullyPopulated,
        );

        expect(outcome.ok).toBe(false);
      }),
      { numRuns: 300 },
    );
  });

  it('parses every well-formed body into a fully populated value', () => {
    fc.assert(
      fc.property(wellFormedArb, (body) => {
        const outcome = settle(() => parseCreatedGuest(body), isFullyPopulated);

        expect(outcome.ok).toBe(true);
        // Carried through unchanged: the identity is opaque to this feature.
        expect(outcome.ok && outcome.value.guestMembershipId).toBe(
          body.guestMembershipId,
        );
      }),
      { numRuns: 500 },
    );
  });

  it('fails when the required field is absent', () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.string({ maxLength: 8 }).filter((key) => key !== 'guestMembershipId'),
          primitiveArb,
          { maxKeys: 4 },
        ),
        (body) => {
          const outcome = settle(() => parseCreatedGuest(body), isFullyPopulated);

          // All or nothing: an object without the identity is a failure, not a
          // Created_Guest with an empty field.
          expect(outcome.ok).toBe(false);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('fails when the required field is mistyped', () => {
    fc.assert(
      fc.property(notAnIdentityArb, (value) => {
        const outcome = settle(
          () => parseCreatedGuest({ guestMembershipId: value }),
          isFullyPopulated,
        );

        expect(outcome.ok).toBe(false);
      }),
      { numRuns: 500 },
    );
  });

  it('fails rather than raising when the named field throws on read', () => {
    fc.assert(
      fc.property(wellFormedArb, (body) => {
        const outcome = settle(
          () => parseCreatedGuest(throwingAt(body, 'guestMembershipId')),
          isFullyPopulated,
        );

        expect(outcome.ok).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  it('is deterministic, so no reading depends on a clock or a counter', () => {
    fc.assert(
      fc.property(fc.oneof(anyBodyArb, wellFormedArb), (body) => {
        expect(parseCreatedGuest(body)).toEqual(parseCreatedGuest(body));
      }),
      { numRuns: 500 },
    );
  });

  it('composes its reason from field labels and never from the value', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('a-secret-invite-token', 'Former player'),
        (secret) => {
          const outcome = settle(
            () => parseCreatedGuest({ guestMembershipId: secret }),
            isFullyPopulated,
          );

          expect(outcome.ok).toBe(false);

          if (!outcome.ok) {
            // 4.10 and 17.2: literal labels only. A guest's display name is PII,
            // so a reason that echoed a field value could put it in a log.
            expect(outcome.reason).not.toContain(secret);
            expect(outcome.reason).toContain('guestMembershipId');
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
