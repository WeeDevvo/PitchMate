import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  MARK_ALL_READ_MEMBER,
  MAX_COUNT_VALUE,
  MIN_COUNT_VALUE,
  UNREAD_COUNT_MEMBER,
  parseCountEnvelope,
  parseMarkAllReadResponse,
  parseNonNegativeInteger,
  parseUnreadCountResponse,
  printCountEnvelope,
  printMarkAllReadResponse,
  printUnreadCountResponse,
  type CountParse,
} from './countParsing';

/**
 * Property tests for the App_Shell's count-envelope parser and printer
 * (Requirements 7.6, 12.5, 12.6, 12.7, 12.10, 12.11), placed beside the module
 * they cover as Requirement 14.2 asks, at well over the 100-iteration floor.
 *
 * These carry the web conjunct of **Property 14: a named envelope preserves the
 * value it wraps, end to end** — the parser recovers exactly the count the named
 * member carries — together with **Property 9: the count rule accepts exactly
 * the non-negative 32-bit integers**. Acceptance is an *exact* characterisation,
 * so every property below is written as an equivalence rather than as a one-way
 * check: a test that only fed well-formed envelopes could not tell this parser
 * from one that accepted everything.
 *
 * The bounds and the member names are read from the module's own exports, not
 * retyped, so a test can never disagree with the implementation about where the
 * boundary sits or what the members are called — the literal boundary values and
 * member names are asserted once, separately, so a wrong constant is still
 * caught.
 */

/**
 * The independent oracle for acceptance: a plain object whose named member is an
 * integer from 0 to 2,147,483,647 inclusive, and nothing else (Requirements 7.6,
 * 12.10). Written from the requirement rather than by reusing the
 * implementation's guards, so the two can disagree.
 */
function shouldParse(body: unknown, member: string): boolean {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return false;
  }

  const value = (body as Record<string, unknown>)[member];

  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 2_147_483_647
  );
}

/** The member value the oracle above would read, for the echo assertions. */
function memberOf(body: unknown, member: string): unknown {
  return (body as Record<string, unknown>)[member];
}

/** Every accepted count: the whole 0..2,147,483,647 range, boundaries included. */
const inRangeCountArb: fc.Arbitrary<number> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.integer({ min: MIN_COUNT_VALUE, max: MAX_COUNT_VALUE }),
  },
  // The boundaries and their neighbours inside the range, generated often
  // enough that shrinking is not what has to find them.
  {
    weight: 1,
    arbitrary: fc.constantFrom(
      0,
      -0,
      1,
      2,
      9,
      10,
      99,
      100,
      MAX_COUNT_VALUE - 1,
      MAX_COUNT_VALUE,
    ),
  },
);

/** Integers just outside the range on either side, plus far-out ones. */
const outOfRangeIntegerArb: fc.Arbitrary<number> = fc.oneof(
  {
    weight: 2,
    arbitrary: fc.constantFrom(
      -1,
      -2,
      MAX_COUNT_VALUE + 1, // 2,147,483,648 — one past the 32-bit ceiling
      MAX_COUNT_VALUE + 2,
      -MAX_COUNT_VALUE,
      Number.MAX_SAFE_INTEGER,
      -Number.MAX_SAFE_INTEGER,
    ),
  },
  { weight: 1, arbitrary: fc.integer({ min: -2_000_000_000, max: -1 }) },
  {
    weight: 1,
    arbitrary: fc.integer({ min: MAX_COUNT_VALUE + 1, max: 4_000_000_000 }),
  },
);

/** Numbers that are not integers: fractional values, NaN, and both infinities. */
const nonIntegerNumberArb: fc.Arbitrary<number> = fc.oneof(
  {
    weight: 2,
    arbitrary: fc.constantFrom(
      0.5,
      -0.5,
      1.1,
      0.1,
      Number.EPSILON,
      MAX_COUNT_VALUE + 0.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.MIN_VALUE,
    ),
  },
  {
    weight: 2,
    arbitrary: fc
      .double({ min: 0, max: MAX_COUNT_VALUE, noNaN: true, noDefaultInfinity: true })
      .filter((value) => !Number.isInteger(value)),
  },
);

/**
 * Non-number member values of every rejected type: absent, null, strings
 * (numeric strings deliberately included — `'7'` is not a number), booleans,
 * arrays, and objects, including a nested count envelope and a one-element array
 * holding a valid count, which are the shapes a coercing parser would wrongly
 * accept.
 */
const nonNumberArb: fc.Arbitrary<unknown> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.constantFrom<unknown>(
      undefined,
      null,
      '0',
      '1',
      '7',
      '2147483647',
      '2147483648',
      '-1',
      ' 3 ',
      '',
      '1e2',
      'seven',
      true,
      false,
      [],
      [0],
      [7],
      [[7]],
      {},
      { count: 7 },
      { markedCount: 7 },
      { value: 7 },
    ),
  },
  { weight: 1, arbitrary: fc.string() },
  { weight: 1, arbitrary: fc.boolean() },
  { weight: 1, arbitrary: fc.array(inRangeCountArb) },
  { weight: 1, arbitrary: fc.record({ count: inRangeCountArb }) },
  { weight: 1, arbitrary: fc.bigInt() },
  { weight: 1, arbitrary: fc.date() },
);

/** Any member value at all, acceptable or not. */
const anyMemberValueArb: fc.Arbitrary<unknown> = fc.oneof(
  { weight: 3, arbitrary: inRangeCountArb },
  { weight: 2, arbitrary: outOfRangeIntegerArb },
  { weight: 2, arbitrary: nonIntegerNumberArb },
  { weight: 3, arbitrary: nonNumberArb },
);

/** An `UnreadCountResponse`-shaped body, well-formed or not. */
const unreadEnvelopeArb: fc.Arbitrary<unknown> = anyMemberValueArb.map((value) => ({
  [UNREAD_COUNT_MEMBER]: value,
}));

/** A `MarkAllReadResponse`-shaped body, well-formed or not. */
const markAllReadEnvelopeArb: fc.Arbitrary<unknown> = anyMemberValueArb.map(
  (value) => ({ [MARK_ALL_READ_MEMBER]: value }),
);

/**
 * Bodies that are not objects at all — including the **bare number** the
 * previous contract sent, which the named envelope replaced (Requirement 7.6).
 */
const nonObjectBodyArb: fc.Arbitrary<unknown> = fc.oneof(
  { weight: 3, arbitrary: inRangeCountArb },
  { weight: 1, arbitrary: outOfRangeIntegerArb },
  { weight: 1, arbitrary: nonIntegerNumberArb },
  {
    weight: 2,
    arbitrary: fc.constantFrom<unknown>(
      undefined,
      null,
      '7',
      '{"count":7}',
      '',
      true,
      false,
      [],
      [7],
      [{ count: 7 }],
    ),
  },
  { weight: 1, arbitrary: fc.string() },
  { weight: 1, arbitrary: fc.array(inRangeCountArb) },
);

/** Anything at all — the totality generator (Requirements 12.6, 14.12). */
const anyBodyArb: fc.Arbitrary<unknown> = fc.oneof(
  { weight: 3, arbitrary: unreadEnvelopeArb },
  { weight: 3, arbitrary: markAllReadEnvelopeArb },
  { weight: 3, arbitrary: nonObjectBodyArb },
  {
    weight: 2,
    arbitrary: fc.record(
      {
        [UNREAD_COUNT_MEMBER]: anyMemberValueArb,
        [MARK_ALL_READ_MEMBER]: anyMemberValueArb,
      },
      { requiredKeys: [] },
    ),
  },
  { weight: 4, arbitrary: fc.anything() },
);

/** The two envelopes, each with the parser, printer, and member that go with it. */
const ENVELOPES = [
  {
    label: 'UnreadCountResponse',
    member: UNREAD_COUNT_MEMBER,
    otherMember: MARK_ALL_READ_MEMBER,
    parse: parseUnreadCountResponse,
    print: printUnreadCountResponse,
  },
  {
    label: 'MarkAllReadResponse',
    member: MARK_ALL_READ_MEMBER,
    otherMember: UNREAD_COUNT_MEMBER,
    parse: parseMarkAllReadResponse,
    print: printMarkAllReadResponse,
  },
] as const;

/** Wraps `leaf` in `depth` levels of arrays and objects, alternating. */
function nest(leaf: unknown, depth: number): unknown {
  let value: unknown = leaf;

  for (let level = 0; level < depth; level += 1) {
    value = level % 2 === 0 ? [value] : { nested: value };
  }

  return value;
}

/** Every outcome is one of the two the union declares, and nothing else. */
function expectWellFormedOutcome(outcome: CountParse): void {
  if (outcome.kind === 'parsed') {
    expect(typeof outcome.value).toBe('number');
  } else {
    expect(outcome.kind).toBe('parse-failure');
    expect(outcome).not.toHaveProperty('value');
  }
}

// Feature: api-response-contracts, Property 14 (web conjunct): a named envelope
// preserves the value it wraps
// Validates: Requirements 7.6, 12.5, 12.10
describe.each(ENVELOPES)(
  '$label — acceptance is exactly the named member carrying an in-range integer',
  ({ member, parse }) => {
    it('parses a body exactly when its named member is an in-range integer, echoing it', () => {
      fc.assert(
        fc.property(anyBodyArb, (body) => {
          const outcome = parse(body);

          expectWellFormedOutcome(outcome);

          // The equivalence: parsed exactly when the oracle says the named
          // member carries an in-range integer (Requirements 7.6, 12.10). Both
          // directions, from one generator covering both.
          expect(outcome.kind === 'parsed').toBe(shouldParse(body, member));

          if (outcome.kind === 'parsed') {
            // The wrapped value is recovered untouched — never clamped,
            // rounded, or re-derived — and `-0` is normalised to `0` so a caller
            // formatting it can never render `-0` (`-0 === 0`, so the equality
            // below still holds for it).
            expect(outcome.value === memberOf(body, member)).toBe(true);
            expect(Object.is(outcome.value, -0)).toBe(false);
            expect(Number.isInteger(outcome.value)).toBe(true);
            expect(outcome.value).toBeGreaterThanOrEqual(MIN_COUNT_VALUE);
            expect(outcome.value).toBeLessThanOrEqual(MAX_COUNT_VALUE);
          }
        }),
        { numRuns: 1000 },
      );
    });

    it('parses every in-range integer carried by the named member', () => {
      fc.assert(
        fc.property(inRangeCountArb, (count) => {
          const outcome = parse({ [member]: count });

          expect(outcome).toStrictEqual({
            kind: 'parsed',
            value: Object.is(count, -0) ? 0 : count,
          });
        }),
        { numRuns: 500 },
      );
    });

    it('ignores every property it does not name, so an added field cannot fail a body', () => {
      fc.assert(
        fc.property(
          inRangeCountArb,
          fc.dictionary(fc.string(), fc.anything(), { maxKeys: 4 }),
          (count, extras) => {
            // Additive-change tolerance: the body with extra properties parses
            // to exactly what the body without them parses to.
            const body = { ...extras, [member]: count };

            expect(parse(body)).toStrictEqual(parse({ [member]: count }));
          },
        ),
        { numRuns: 300 },
      );
    });

    it('rejects a bare number, the wire form the named envelope replaced', () => {
      fc.assert(
        fc.property(nonObjectBodyArb, (body) => {
          // 7.6: the App_Shell reads the named member of an object body, so the
          // old bare-number body no longer parses rather than silently still
          // working.
          expect(parse(body)).toStrictEqual({ kind: 'parse-failure' });
        }),
        { numRuns: 300 },
      );
    });

    it('rejects a member value that is not an in-range integer, all or nothing', () => {
      const rejectedMemberArb = fc.oneof(
        outOfRangeIntegerArb,
        nonIntegerNumberArb,
        nonNumberArb,
      );

      fc.assert(
        fc.property(rejectedMemberArb, (value) => {
          // Rejected, not clamped or defaulted: no `0` for `-1`, no ceiling for
          // an overflowing count, no coercion of `'7'` (Requirements 12.5,
          // 12.7).
          expect(parse({ [member]: value })).toStrictEqual({ kind: 'parse-failure' });
        }),
        { numRuns: 500 },
      );
    });
  },
);

// Feature: api-response-contracts, Property 14 (web conjunct): the two envelopes
// are distinct
// Validates: Requirements 7.1, 7.2, 7.6
describe('the two count envelopes are read by their own member name', () => {
  it('holds the stated member names and boundaries', () => {
    // The names and the bounds are the contract (Requirements 7.1, 7.2, 10.9),
    // so they are asserted literally here — the generated properties read them
    // from the module and so could not catch a wrong constant on their own.
    expect(UNREAD_COUNT_MEMBER).toBe('count');
    expect(MARK_ALL_READ_MEMBER).toBe('markedCount');
    expect(MIN_COUNT_VALUE).toBe(0);
    expect(MAX_COUNT_VALUE).toBe(2_147_483_647);

    expect(parseUnreadCountResponse({ count: 0 })).toStrictEqual({
      kind: 'parsed',
      value: 0,
    });
    expect(parseUnreadCountResponse({ count: 2_147_483_647 })).toStrictEqual({
      kind: 'parsed',
      value: 2_147_483_647,
    });
    expect(parseUnreadCountResponse({ count: 2_147_483_648 }).kind).toBe(
      'parse-failure',
    );
    expect(parseUnreadCountResponse({ count: -1 }).kind).toBe('parse-failure');

    expect(parseMarkAllReadResponse({ markedCount: 0 })).toStrictEqual({
      kind: 'parsed',
      value: 0,
    });
    expect(parseMarkAllReadResponse({ markedCount: 2_147_483_647 })).toStrictEqual({
      kind: 'parsed',
      value: 2_147_483_647,
    });
    expect(parseMarkAllReadResponse({ markedCount: 2_147_483_648 }).kind).toBe(
      'parse-failure',
    );
    expect(parseMarkAllReadResponse({ markedCount: -1 }).kind).toBe('parse-failure');
  });

  it('fails each parser on the other envelope, so neither reads the other body', () => {
    fc.assert(
      fc.property(inRangeCountArb, (count) => {
        for (const { member, otherMember, parse } of ENVELOPES) {
          expect(parse({ [otherMember]: count }).kind).toBe('parse-failure');
          expect(parse({ [member]: count }).kind).toBe('parsed');
        }
      }),
      { numRuns: 300 },
    );
  });

  it('reads each member independently when a body carries both', () => {
    fc.assert(
      fc.property(inRangeCountArb, inRangeCountArb, (unread, marked) => {
        const body = { count: unread, markedCount: marked };

        expect(parseUnreadCountResponse(body)).toStrictEqual({
          kind: 'parsed',
          value: Object.is(unread, -0) ? 0 : unread,
        });
        expect(parseMarkAllReadResponse(body)).toStrictEqual({
          kind: 'parsed',
          value: Object.is(marked, -0) ? 0 : marked,
        });
      }),
      { numRuns: 300 },
    );
  });
});

// Feature: api-response-contracts, Property 14 (web conjunct): printer round trip
// Validates: Requirements 7.4, 12.11
describe('the count printers round-trip through their parsers', () => {
  it('recovers exactly the count a printed envelope wraps', () => {
    fc.assert(
      fc.property(inRangeCountArb, (count) => {
        const expected = Object.is(count, -0) ? 0 : count;

        expect(parseUnreadCountResponse(printUnreadCountResponse(count))).toStrictEqual(
          { kind: 'parsed', value: expected },
        );
        expect(
          parseMarkAllReadResponse(printMarkAllReadResponse(count)),
        ).toStrictEqual({ kind: 'parsed', value: expected });
      }),
      { numRuns: 500 },
    );
  });

  it('prints each count under its own member name and nothing else', () => {
    fc.assert(
      fc.property(inRangeCountArb, (count) => {
        expect(printUnreadCountResponse(count)).toStrictEqual({ count });
        expect(printMarkAllReadResponse(count)).toStrictEqual({ markedCount: count });

        // The printed body survives the JSON hop the transport makes of it.
        const hopped: unknown = JSON.parse(JSON.stringify(printUnreadCountResponse(count)));

        expect(parseUnreadCountResponse(hopped)).toStrictEqual({
          kind: 'parsed',
          value: Object.is(count, -0) ? 0 : count,
        });
      }),
      { numRuns: 300 },
    );
  });

  it('recovers a printed count through the generic envelope pair, for either member', () => {
    fc.assert(
      fc.property(
        inRangeCountArb,
        fc.constantFrom(UNREAD_COUNT_MEMBER, MARK_ALL_READ_MEMBER),
        (count, member) => {
          // `printCountEnvelope`/`parseCountEnvelope` are the exported pair the
          // two named wrappers delegate to, so the round trip is claimed over
          // the shared implementation and not only over its two call sites
          // (Requirement 12.11).
          const expected = Object.is(count, -0) ? 0 : count;

          expect(
            parseCountEnvelope(printCountEnvelope(count, member), member),
          ).toStrictEqual({ kind: 'parsed', value: expected });

          // The printed body names that member and nothing else, so the other
          // envelope's parser refuses it.
          const otherMember =
            member === UNREAD_COUNT_MEMBER ? MARK_ALL_READ_MEMBER : UNREAD_COUNT_MEMBER;

          expect(
            parseCountEnvelope(printCountEnvelope(count, member), otherMember).kind,
          ).toBe('parse-failure');
        },
      ),
      { numRuns: 300 },
    );
  });

  it('prints an unacceptable count into a body its parser rejects', () => {
    fc.assert(
      fc.property(fc.oneof(outOfRangeIntegerArb, nonIntegerNumberArb), (value) => {
        // A value that cannot round-trip must not appear to: the printer renders
        // it and the parser refuses it, rather than either of them repairing it.
        expect(parseUnreadCountResponse(printUnreadCountResponse(value)).kind).toBe(
          'parse-failure',
        );
        expect(parseMarkAllReadResponse(printMarkAllReadResponse(value)).kind).toBe(
          'parse-failure',
        );
      }),
      { numRuns: 300 },
    );
  });
});

// Feature: api-response-contracts, Property 9: the value rule accepts exactly
// the non-negative 32-bit integers
// Validates: Requirements 10.9, 12.5
describe('parseNonNegativeInteger — the one value rule behind both envelopes', () => {
  it('accepts a value exactly when it is an in-range integer, and echoes it', () => {
    fc.assert(
      fc.property(anyMemberValueArb, (value) => {
        const outcome = parseNonNegativeInteger(value);

        expectWellFormedOutcome(outcome);
        expect(outcome.kind === 'parsed').toBe(
          typeof value === 'number' &&
            Number.isInteger(value) &&
            value >= 0 &&
            value <= 2_147_483_647,
        );

        if (outcome.kind === 'parsed') {
          expect(outcome.value === (value as number)).toBe(true);
          expect(Object.is(outcome.value, -0)).toBe(false);
        }
      }),
      { numRuns: 1000 },
    );
  });

  it('is the rule both envelope parsers apply, with no second notion of a count', () => {
    fc.assert(
      fc.property(anyMemberValueArb, (value) => {
        // One rule behind both responses (Requirement 10.9): wrapping a value in
        // either envelope yields exactly what the value rule says of it.
        for (const { member, parse } of ENVELOPES) {
          expect(parse({ [member]: value })).toStrictEqual(
            parseNonNegativeInteger(value),
          );
        }
      }),
      { numRuns: 500 },
    );
  });

  it('performs no coercion, so a hostile toString or valueOf never runs', () => {
    fc.assert(
      fc.property(inRangeCountArb, (count) => {
        let conversions = 0;
        const hostile = {
          valueOf() {
            conversions += 1;
            return count;
          },
          toString() {
            conversions += 1;
            return String(count);
          },
        };

        expect(parseUnreadCountResponse({ count: hostile })).toStrictEqual({
          kind: 'parse-failure',
        });
        expect(parseNonNegativeInteger(hostile)).toStrictEqual({
          kind: 'parse-failure',
        });
        expect(conversions).toBe(0);
      }),
      { numRuns: 200 },
    );
  });
});

// Feature: api-response-contracts, Property 14 (web conjunct): the parser is total
// Validates: Requirements 12.6, 14.12
describe('the count parsers are total', () => {
  it('yields one defined outcome and raises no exception for any body of any type', () => {
    fc.assert(
      fc.property(anyBodyArb, (body) => {
        for (const { parse } of ENVELOPES) {
          const outcome = parse(body);

          expect(outcome).toBeDefined();
          expect(['parsed', 'parse-failure']).toContain(outcome.kind);
          expectWellFormedOutcome(outcome);
        }
      }),
      { numRuns: 1000 },
    );
  });

  it('yields the parse-failure outcome for a body nested to 100 levels', () => {
    const leafArb = fc.oneof(
      unreadEnvelopeArb,
      markAllReadEnvelopeArb,
      nonObjectBodyArb,
    );

    fc.assert(
      fc.property(leafArb, fc.integer({ min: 1, max: 100 }), (leaf, depth) => {
        // A nested body never carries the named member at its top level, so it is
        // always a parse-failure — and the parser does not walk into it, so 100
        // levels cost nothing and overflow nothing (Requirement 12.6).
        const nested = nest(leaf, depth);

        for (const { parse } of ENVELOPES) {
          expect(parse(nested)).toStrictEqual({ kind: 'parse-failure' });
        }
      }),
      { numRuns: 300 },
    );
  });

  it('survives values with no prototype, exotic wrappers, and self-referencing structures', () => {
    const selfReferencing: Record<string, unknown> = { count: '7' };
    selfReferencing.self = selfReferencing;

    const cyclicArray: unknown[] = [1];
    cyclicArray.push(cyclicArray);

    const throwingGetter = {
      get count(): number {
        throw new Error('a throwing member reads as absent');
      },
      get markedCount(): number {
        throw new Error('a throwing member reads as absent');
      },
    };

    const exotic: unknown[] = [
      Object.create(null),
      Object(7), // a boxed number: an object carrying no named member
      Object('7'),
      Object(true),
      Symbol('7'),
      7n,
      () => 7,
      new Map([['count', 7]]),
      new Set([7]),
      selfReferencing,
      cyclicArray,
      throwingGetter,
      nest({ count: 7 }, 100),
    ];

    for (const value of exotic) {
      for (const { parse } of ENVELOPES) {
        expect(parse(value)).toStrictEqual({ kind: 'parse-failure' });
      }
    }
  });

  it('reads a count carried by an object with no prototype', () => {
    // A body decoded from JSON has `Object.prototype`, but a parser that relied
    // on a prototype method would break on one that does not — and the member is
    // an own property either way.
    const bare = Object.create(null) as Record<string, unknown>;
    bare.count = 12;

    expect(parseUnreadCountResponse(bare)).toStrictEqual({ kind: 'parsed', value: 12 });
  });

  it('is deterministic and free of side effects across repeated calls', () => {
    fc.assert(
      fc.property(anyBodyArb, (body) => {
        for (const { member, parse } of ENVELOPES) {
          const first = parse(body);
          const second = parseCountEnvelope(body, member);

          expect(second).toStrictEqual(first);
          expect(parse(body)).toStrictEqual(first);
        }
      }),
      { numRuns: 300 },
    );
  });
});
