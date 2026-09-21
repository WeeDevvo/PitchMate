import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import type { ParseResult } from './primitives';
import { parseInvitePreview, type InvitePreview } from './invitePreview';

/**
 * Property test for the `PreviewInvite` body shape, placed beside the module it
 * covers as the design's Testing Strategy asks and running well above the
 * 100-iteration floor (20.1).
 *
 * This file carries **Property 35** for `invitePreview.ts`: for any value supplied
 * as a response body — absent, `null`, a primitive of every type, an array, an
 * object with each required field missing, an object with each field mistyped, and
 * a value nested a hundred levels deep — the parser yields exactly one of a fully
 * populated Invite_Preview and a parse failure, and raises nothing (16.4).
 *
 * This is the one anonymous squads call, and both of its fields are required.
 *
 * **`requiresAuthentication` is a strict boolean.** The dangerous direction is a
 * defaulted `false`, which would say authentication is unnecessary on the strength
 * of a value nobody sent, so the generators feed the truthy and falsy non-booleans
 * a lenient reader would accept — `0`, `1`, `'true'`, `'false'`, `''`, `null` —
 * and each must fail the body.
 *
 * **`message` is parsed but never rendered** (17.2), so its content is irrelevant
 * to correctness and its *shape* is all this parser establishes. The assertions
 * treat it as an arbitrary string, including empty, whitespace, and text that looks
 * like backend problem detail.
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
      '1',
      'true',
      'false',
      'null',
      '{}',
      0n,
      1n,
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
      new Map<unknown, unknown>([['requiresAuthentication', true]]),
      new Set<unknown>([1]),
      () => ({}),
      Object(1),
      Object(true),
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

/**
 * Values no boolean field accepts, the truthy and falsy near misses first: a
 * lenient reader would take `0`, `1`, `'true'`, `''`, and `null` for booleans, and
 * a defaulted `requiresAuthentication: false` is the one reading of this shape
 * with a security consequence.
 */
const notABooleanArb: fc.Arbitrary<unknown> = fc.oneof(
  {
    weight: 5,
    arbitrary: fc.constantFrom<unknown>(
      undefined,
      null,
      0,
      1,
      -0,
      'true',
      'false',
      'True',
      '1',
      '0',
      '',
      ' ',
      Number.NaN,
      [],
      [true],
      {},
      { requiresAuthentication: true },
      Object(true),
      0n,
      1n,
    ),
  },
  { weight: 3, arbitrary: anyBodyArb.filter((value) => typeof value !== 'boolean') },
);

/** Values no required string field accepts. */
const notAStringArb: fc.Arbitrary<unknown> = fc.oneof(
  {
    weight: 5,
    arbitrary: fc.constantFrom<unknown>(
      undefined,
      null,
      0,
      1,
      true,
      false,
      Number.NaN,
      [],
      ['a'],
      {},
      { message: 'a' },
      Object('a'),
      0n,
      Symbol('a'),
    ),
  },
  { weight: 3, arbitrary: anyBodyArb.filter((value) => typeof value !== 'string') },
);

/* -------------------------------------------------------------------------- */
/* Well-formed bodies, and what a populated value must look like              */
/* -------------------------------------------------------------------------- */

/**
 * Backend wording the parser reads and the interface never renders, including the
 * problem-detail shapes Requirement 17.2 keeps off the screen.
 */
const messageArb: fc.Arbitrary<string> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.constantFrom(
      '',
      ' ',
      'Sign in to accept this invite.',
      'Squad "The Wanderers" is waiting for you.',
      'x'.repeat(1000),
    ),
  },
  { weight: 2, arbitrary: fc.string({ maxLength: 60 }) },
  { weight: 1, arbitrary: fc.string({ unit: 'grapheme', maxLength: 12 }) },
);

/**
 * A well-formed `PreviewInvite` body. `requiresAuthentication` is generated as
 * both booleans even though the backend answers a fixed `true`: the parser's
 * contract is the type, not the value, and a reader that special-cased `true`
 * would fail here.
 */
const wellFormedArb: fc.Arbitrary<Record<string, unknown>> = fc.record({
  requiresAuthentication: fc.boolean(),
  message: messageArb,
});

/** Every field this shape declares. */
const FIELDS = ['requiresAuthentication', 'message'] as const;

/**
 * Whether a parsed Invite_Preview is fully populated: exactly the two declared
 * fields, each of its declared type, with neither left `undefined`.
 */
function isFullyPopulated(preview: InvitePreview): boolean {
  return (
    keySignature(preview) === 'message,requiresAuthentication' &&
    typeof preview.requiresAuthentication === 'boolean' &&
    typeof preview.message === 'string'
  );
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

// Feature: web-squads-screens, Property 35: Every response parser is total and never yields a partial value
// Validates: Requirements 16.4, 20.10
describe('parseInvitePreview — total, and never partial', () => {
  it('settles every input into exactly one of a populated value and a failure', () => {
    fc.assert(
      fc.property(anyBodyArb, (body) => {
        settle(() => parseInvitePreview(body), isFullyPopulated);
      }),
      { numRuns: 1000 },
    );
  });

  it('settles a value nested to 100 levels', () => {
    fc.assert(
      fc.property(deeplyNestedArb, (body) => {
        const outcome = settle(() => parseInvitePreview(body), isFullyPopulated);

        expect(outcome.ok).toBe(false);
      }),
      { numRuns: 300 },
    );
  });

  it('settles a well-formed body whose field is 100 levels deep', () => {
    fc.assert(
      fc.property(
        wellFormedArb,
        fc.constantFrom(...FIELDS),
        deeplyNestedArb,
        (body, key, deep) => {
          const outcome = settle(
            () => parseInvitePreview({ ...body, [key]: deep }),
            isFullyPopulated,
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
        const outcome = settle(() => parseInvitePreview(body), isFullyPopulated);

        expect(outcome.ok).toBe(true);

        if (outcome.ok) {
          expect(outcome.value.requiresAuthentication).toBe(
            body.requiresAuthentication,
          );
          // Read exactly as sent: nothing trimmed, nothing rewritten. It is simply
          // never rendered (17.2).
          expect(outcome.value.message).toBe(body.message);
        }
      }),
      { numRuns: 500 },
    );
  });

  it('fails when either required field is absent', () => {
    fc.assert(
      fc.property(wellFormedArb, fc.constantFrom(...FIELDS), (body, key) => {
        const outcome = settle(
          () => parseInvitePreview(without(body, key)),
          isFullyPopulated,
        );

        // All or nothing, and in particular no defaulted `false`: authentication
        // must never be declared unnecessary on the strength of an absence.
        expect(outcome.ok).toBe(false);
      }),
      { numRuns: 300 },
    );
  });

  it('fails when either required field is mistyped', () => {
    fc.assert(
      fc.property(
        wellFormedArb,
        fc.oneof(
          fc.tuple(fc.constant('requiresAuthentication'), notABooleanArb),
          fc.tuple(fc.constant('message'), notAStringArb),
        ),
        (body, [key, value]) => {
          const outcome = settle(
            () => parseInvitePreview({ ...body, [key]: value }),
            isFullyPopulated,
          );

          expect(outcome.ok).toBe(false);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('reads no truthy or falsy value as a boolean', () => {
    fc.assert(
      fc.property(
        messageArb,
        fc.constantFrom<unknown>(0, 1, '', 'true', 'false', null, [], {}, Object(true)),
        (message, notABoolean) => {
          const outcome = settle(
            () =>
              parseInvitePreview({
                requiresAuthentication: notABoolean,
                message,
              }),
            isFullyPopulated,
          );

          expect(outcome.ok).toBe(false);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('fails rather than raising when a named field throws on read', () => {
    fc.assert(
      fc.property(wellFormedArb, fc.constantFrom(...FIELDS), (body, key) => {
        const outcome = settle(
          () => parseInvitePreview(throwingAt(body, key)),
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
        expect(parseInvitePreview(body)).toEqual(parseInvitePreview(body));
      }),
      { numRuns: 500 },
    );
  });

  it('composes its reason from field labels and never from the backend wording', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.constantFrom(
          'Squad "The Wanderers" is waiting for you.',
          'a-secret-invite-token',
        ),
        (requiresAuthentication, wording) => {
          const outcome = settle(
            () =>
              parseInvitePreview({
                requiresAuthentication,
                // Mistyped as an array carrying the wording, so the wording is
                // present in the body but must not reach the reason.
                message: [wording],
              }),
            isFullyPopulated,
          );

          expect(outcome.ok).toBe(false);

          if (!outcome.ok) {
            // 17.2: no backend wording reaches a message, and a reason is the one
            // string a malformed body could otherwise smuggle it into.
            expect(outcome.reason).not.toContain(wording);
            expect(outcome.reason).toContain('message');
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
