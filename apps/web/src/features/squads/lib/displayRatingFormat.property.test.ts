import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { formatDisplayRating, selectRatingPresentation } from './ratingPresentation';
import type {
  DisplayRatingEntry,
  DisplayRatingLeaderboard,
} from './parse/leaderboard';
import type { SquadMember } from './parse/squadDetail';

/**
 * Property tests for the arithmetic and the rendered shape of a Display_Rating,
 * beside the module they cover as the design's Testing Strategy asks, and running
 * well above the 100-iteration floor (Requirement 20.1).
 *
 * The sibling file `ratingPresentation.property.test.ts` owns the three-branch
 * selection claims — which of a Display_Rating, a Provisional_Band, and a
 * Rating_Unavailable label comes back for which input (Property 19). What is
 * claimed **here** is narrower and entirely numeric: given that a row does get a
 * number, that number is the matching entry's value rounded half away from zero,
 * it renders as a decimal integer, and nothing else the entry carries moves it.
 *
 * Three claims:
 *
 * - **The rounding is half away from zero** (Requirement 8.2). Asserted against an
 *   independently written oracle that reaches the answer by a different route: it
 *   compares the value's distance to the integer below and the integer above and
 *   only breaks an *exact* tie by sign, where the module rounds the magnitude with
 *   `Math.round` and reapplies the sign. Both gaps are computed as `x - floor(x)`
 *   and `ceil(x) - x`, which are exact in binary floating point for any finite
 *   non-integral `x`, so the oracle detects a genuine tie rather than
 *   approximating one.
 * - **The rendered string is a decimal integer** (Requirement 8.1): no fractional
 *   part, no grouping separator, no leading zero, and no exponent — asserted on
 *   `String(value)`, which is how a component renders it. A worked comparison
 *   against `toLocaleString('en-US')` is included, because a grouping separator is
 *   exactly what a locale formatter would have inserted.
 * - **Only the matching entry's `value` contributes** (Requirement 8.9). Driven
 *   through `selectRatingPresentation` over entries decorated with plausible extra
 *   properties — a rank, a mean skill estimate, an uncertainty value, a display
 *   scale and offset — and over leaderboards whose *other* entries carry different
 *   values. The rating must be identical to the one obtained from the undecorated
 *   entry, and the returned presentation must carry no field beyond `kind` and
 *   `value`, so no extra value can reach a row even by accident.
 *
 * The generators put their weight where the rule is: exact halves in both signs at
 * every scale (`-0.5`, `0.5`, `1.5`, `-2.5` by name), the `0.49999999999999994`
 * case that defeats a `floor(x + 0.5)` implementation, magnitudes at and just
 * below `Number.MAX_SAFE_INTEGER`, and the smallest representable magnitudes,
 * where the answer must be **positive** zero rather than `-0`.
 *
 * The string-shape claim is stated over magnitudes within the safe-integer range,
 * which is where a rating lives; the rounding and integrality claims are stated
 * over the whole finite double range, including magnitudes so large that
 * JavaScript renders them in exponent form.
 */

// --- the oracle --------------------------------------------------------------

/**
 * Positive zero for either signed zero. Both the module and this oracle must
 * answer `0` and never `-0` for a magnitude that rounds away, and `Object.is`
 * distinguishes the two, so the normalisation is stated once and applied on both
 * sides of every comparison.
 */
function normaliseZero(candidate: number): number {
  return Object.is(candidate, -0) ? 0 : candidate;
}

/**
 * Requirement 8.2's rule written from the criterion rather than from the module:
 * the nearer of the two adjacent integers, with an exact half going away from
 * zero.
 *
 * `value - lower` and `upper - value` are exact for any finite non-integral
 * double — the fractional part of a double needs no more significand bits than the
 * double itself — so `belowGap === aboveGap` is a true tie and not a rounding
 * artefact of the oracle. That matters: an oracle that computed the gaps
 * approximately could disagree with the module on precisely the inputs the
 * criterion is about.
 */
function roundHalfAwayFromZero(value: number): number {
  const lower = Math.floor(value);
  const upper = Math.ceil(value);

  // Already integral — including every magnitude at or beyond 2^52, where no
  // double has a fractional part left to round.
  if (lower === upper) {
    return normaliseZero(value);
  }

  const belowGap = value - lower;
  const aboveGap = upper - value;

  if (belowGap < aboveGap) {
    return normaliseZero(lower);
  }

  if (aboveGap < belowGap) {
    return normaliseZero(upper);
  }

  // The exact half: away from zero, so up on the positive side and down on the
  // negative side. `Math.round` would take both upward.
  return normaliseZero(value > 0 ? upper : lower);
}

/** A decimal integer: optional sign, no grouping, no exponent, no leading zero. */
const DECIMAL_INTEGER = /^(?:0|-?[1-9][0-9]*)$/;

/**
 * Asserts the rendered form of a Display_Rating satisfies Requirement 8.1: a
 * decimal integer with no fractional part, no grouping separator, and no leading
 * zero — and no `-0`, which the pattern excludes by allowing an unsigned `0` only.
 */
function expectRendersAsDecimalInteger(rating: number): void {
  const rendered = String(rating);

  expect(rendered).toMatch(DECIMAL_INTEGER);
  expect(rendered).not.toContain('.');
  expect(rendered).not.toContain(',');
  expect(rendered).not.toContain(' ');
  // The non-breaking and narrow non-breaking spaces several locales group with.
  expect(rendered).not.toContain('\u00a0');
  expect(rendered).not.toContain('\u202f');
  expect(rendered.toLowerCase()).not.toContain('e');
}

// --- named boundary values ---------------------------------------------------

/**
 * The half-way cases the task names, plus the ones a careless implementation gets
 * wrong: `0.49999999999999994` sums to exactly `1` under `floor(x + 0.5)` when the
 * nearest integer is `0`, and the negative halves are where `Math.round` alone
 * rounds *toward* zero.
 */
const ROUNDING_EXAMPLES: readonly (readonly [number, number])[] = [
  [0.5, 1],
  [-0.5, -1],
  [1.5, 2],
  [-1.5, -2],
  [2.5, 3],
  [-2.5, -3],
  [0.4, 0],
  [-0.4, 0],
  [0.6, 1],
  [-0.6, -1],
  [0.49999999999999994, 0],
  [-0.49999999999999994, 0],
  [1.4999999999999998, 1],
  [-1.4999999999999998, -1],
  [0, 0],
  [-0, 0],
  [Number.MIN_VALUE, 0],
  [-Number.MIN_VALUE, 0],
  [Number.EPSILON, 0],
  [-Number.EPSILON, 0],
  [999.5, 1000],
  [-999.5, -1000],
  // 2^52 - 0.5: the largest magnitude at which a double still has a half to
  // round, since the spacing reaches 1 at 2^52.
  [4503599627370495.5, 4503599627370496],
  [-4503599627370495.5, -4503599627370496],
  [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  [-Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER],
];

// --- generators --------------------------------------------------------------

/** An exact half at any scale a double can represent one, in both signs. */
const exactHalfArb: fc.Arbitrary<number> = fc
  .integer({ min: 0, max: 2 ** 40 })
  .chain((whole) => fc.constantFrom(whole + 0.5, -(whole + 0.5)));

/**
 * Magnitudes at and around `Number.MAX_SAFE_INTEGER` and `2^52`: already-integral
 * values that must pass through untouched, and the last scale at which a half
 * exists.
 */
const nearSafeIntegerArb: fc.Arbitrary<number> = fc
  .integer({ min: 0, max: 4 })
  .chain((offset) =>
    fc.constantFrom(
      Number.MAX_SAFE_INTEGER - offset,
      -(Number.MAX_SAFE_INTEGER - offset),
      2 ** 52 + offset,
      -(2 ** 52 + offset),
      2 ** 52 - 0.5 - offset,
      -(2 ** 52 - 0.5 - offset),
    ),
  );

/** The smallest magnitudes, where the answer must be positive zero. */
const nearZeroArb: fc.Arbitrary<number> = fc.constantFrom(
  0,
  -0,
  Number.MIN_VALUE,
  -Number.MIN_VALUE,
  Number.EPSILON,
  -Number.EPSILON,
  1e-320,
  -1e-320,
  0.49999999999999994,
  -0.49999999999999994,
);

/** Every named example, so the table is generated over as well as enumerated. */
const namedExampleArb: fc.Arbitrary<number> = fc.constantFrom(
  ...ROUNDING_EXAMPLES.map(([value]) => value),
);

/** An integer already in rating shape: rounding must be the identity on it. */
const integralArb: fc.Arbitrary<number> = fc.integer({
  min: -Number.MAX_SAFE_INTEGER,
  max: Number.MAX_SAFE_INTEGER,
});

/** An arbitrary finite value within the safe-integer range. */
const withinSafeRangeArb: fc.Arbitrary<number> = fc.double({
  min: -Number.MAX_SAFE_INTEGER,
  max: Number.MAX_SAFE_INTEGER,
  noNaN: true,
});

/**
 * A finite leaderboard value whose rounding renders as a decimal integer: the
 * whole safe-integer range, weighted towards the halves and the boundaries.
 */
const safeRangeValueArb: fc.Arbitrary<number> = fc.oneof(
  { weight: 5, arbitrary: exactHalfArb },
  { weight: 3, arbitrary: nearSafeIntegerArb },
  { weight: 3, arbitrary: nearZeroArb },
  { weight: 2, arbitrary: namedExampleArb },
  { weight: 2, arbitrary: integralArb },
  { weight: 5, arbitrary: withinSafeRangeArb },
);

/**
 * Any finite value at all, including magnitudes far beyond the safe-integer range.
 * The rounding claim holds over these; the *string* claim is not made about them,
 * because JavaScript renders a magnitude at or above 1e21 in exponent form and no
 * rounding could change that.
 */
const anyFiniteValueArb: fc.Arbitrary<number> = fc.oneof(
  { weight: 6, arbitrary: safeRangeValueArb },
  {
    weight: 2,
    arbitrary: fc.double({ min: -1e300, max: 1e300, noNaN: true }),
  },
  {
    weight: 1,
    arbitrary: fc.constantFrom(
      Number.MAX_VALUE,
      -Number.MAX_VALUE,
      1e21,
      -1e21,
      2 ** 53,
      -(2 ** 53),
    ),
  },
);

// --- the leaderboard harness -------------------------------------------------

/**
 * Property names a leaderboard entry might plausibly acquire — a rank, the model
 * quantities, the display scale and offset — none of which may reach a row.
 * Requirement 8.9 keeps the mapping from the model to a friendly number in the
 * backend, so an entry that volunteered these must still yield the same rating.
 */
const DECORATION_KEYS: readonly string[] = [
  'rank',
  'skillEstimate',
  'uncertaintyValue',
  'displayScale',
  'displayOffset',
  'matchesPlayed',
  'previousValue',
  'statistic',
  'provisional',
];

const decorationArb: fc.Arbitrary<Readonly<Record<string, unknown>>> =
  fc.dictionary(
    fc.constantFrom(...DECORATION_KEYS),
    fc.oneof(
      fc.double({ min: -1e6, max: 1e6, noNaN: true }),
      fc.integer(),
      fc.string({ maxLength: 8 }),
      fc.boolean(),
      fc.constant(null),
    ),
    { maxKeys: 5 },
  );

/**
 * An entry carrying extra properties. The cast is the point of the test: the wire
 * body genuinely can carry more than the parser declares, and Requirement 16.9
 * disregards the surplus, so the surplus has to be present for the claim to mean
 * anything.
 */
function decorate(
  entry: DisplayRatingEntry,
  decoration: Readonly<Record<string, unknown>>,
): DisplayRatingEntry {
  const decorated: Record<string, unknown> = { ...entry, ...decoration };

  return decorated as unknown as DisplayRatingEntry;
}

/** A Squad_Member whose row is being presented; only its identity is read. */
function memberWithIdentity(membershipId: string, displayName: string): SquadMember {
  return {
    membershipId,
    displayName,
    role: 'member',
    state: 'active',
    isGuest: false,
  };
}

/** The rating a presentation carries, or `null` for the other two presentations. */
function ratingOf(
  member: SquadMember,
  leaderboard: DisplayRatingLeaderboard,
): number | null {
  const presentation = selectRatingPresentation(member, leaderboard);

  return presentation.kind === 'rating' ? presentation.value : null;
}

/**
 * A matching entry with a generated value, a display name, extra properties, and
 * other entries around it whose values differ — everything a rating must not be
 * derived from.
 */
const decoratedLeaderboardArb = fc
  .uniqueArray(fc.uuid(), { minLength: 1, maxLength: 6 })
  .chain((identities) =>
    fc.record({
      identities: fc.constant(identities),
      matchIndex: fc.nat({ max: identities.length - 1 }),
      value: safeRangeValueArb,
      matchDisplayName: fc.oneof(
        fc.string({ maxLength: 16 }),
        fc.constantFrom('1234', '-99.5', 'Former player', ''),
      ),
      decoration: decorationArb,
      otherValues: fc.array(
        fc.oneof(
          safeRangeValueArb,
          fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
        ),
        { minLength: 6, maxLength: 6 },
      ),
      otherDecoration: decorationArb,
    }),
  );

// Feature: web-squads-screens, Property 20: A Display_Rating is the entry's value
// rounded half away from zero
// Validates: Requirements 8.2, 20.1
describe('formatDisplayRating — the value is rounded to the nearest integer, ties away from zero', () => {
  it('agrees with an independent nearest-integer oracle over every finite value', () => {
    fc.assert(
      fc.property(anyFiniteValueArb, (value) => {
        // The oracle picks the nearer adjacent integer and only breaks an exact
        // tie by sign, so this checks Requirement 8.2 rather than restating the
        // module's magnitude-and-sign body.
        expect(formatDisplayRating(value)).toBe(roundHalfAwayFromZero(value));
      }),
      { numRuns: 1000 },
    );
  });

  it('rounds an exact half away from zero at every scale, in both signs', () => {
    fc.assert(
      fc.property(exactHalfArb, (half) => {
        const rating = formatDisplayRating(half);

        // Away from zero means the magnitude grows by exactly the half, which is
        // what distinguishes this from `Math.round`: for -0.5 the answer is -1.
        expect(Math.abs(rating)).toBe(Math.abs(half) + 0.5);
        expect(Math.sign(rating)).toBe(Math.sign(half));
        expect(rating).toBe(roundHalfAwayFromZero(half));
      }),
      { numRuns: 600 },
    );
  });

  it('rounds the named boundary values as Requirement 8.2 states', () => {
    // Enumerated as well as generated, so the halves the criterion turns on are
    // checkable by eye: 0.5 → 1, -0.5 → -1, 1.5 → 2, -2.5 → -3.
    for (const [value, expected] of ROUNDING_EXAMPLES) {
      expect({ value: String(value), rating: formatDisplayRating(value) }).toEqual({
        value: String(value),
        rating: expected,
      });
    }
  });

  it('is symmetric in the sign, so a negative value is not rounded toward zero', () => {
    fc.assert(
      fc.property(anyFiniteValueArb, (value) => {
        const positive = formatDisplayRating(Math.abs(value));

        // `Math.round` fails this: it maps 2.5 to 3 but -2.5 to -2.
        expect(Math.abs(formatDisplayRating(-Math.abs(value)))).toBe(positive);
      }),
      { numRuns: 600 },
    );
  });

  it('moves the value by at most a half, and no adjacent integer is nearer', () => {
    fc.assert(
      fc.property(safeRangeValueArb, (value) => {
        const rating = formatDisplayRating(value);
        const distance = Math.abs(rating - value);

        // "Nearest integer" stated as a bound rather than as a formula: within half
        // a unit, and no closer integer exists on either side.
        expect(distance).toBeLessThanOrEqual(0.5);
        expect(distance).toBeLessThanOrEqual(Math.abs(Math.floor(value) - value));
        expect(distance).toBeLessThanOrEqual(Math.abs(Math.ceil(value) - value));
      }),
      { numRuns: 600 },
    );
  });

  it('leaves an integer unchanged and is idempotent on its own result', () => {
    fc.assert(
      fc.property(fc.oneof(integralArb, nearSafeIntegerArb), (value) => {
        if (Number.isInteger(value)) {
          expect(formatDisplayRating(value)).toBe(normaliseZero(value));
        }

        const rating = formatDisplayRating(value);

        // Rounding a rating again changes nothing, so a value that has been
        // through this function once is safe to pass through it again.
        expect(formatDisplayRating(rating)).toBe(rating);
      }),
      { numRuns: 600 },
    );
  });

  it('returns positive zero for every magnitude that rounds away, never -0', () => {
    fc.assert(
      fc.property(fc.oneof(nearZeroArb, fc.double({ min: -0.5, max: 0.5, noNaN: true })), (value) => {
        const rating = formatDisplayRating(value);

        // A row showing "-0" would be a rating nobody has; the sign is dropped
        // once the magnitude rounds to nothing.
        if (rating === 0) {
          expect(Object.is(rating, -0)).toBe(false);
          expect(String(rating)).toBe('0');
        }
      }),
      { numRuns: 600 },
    );
  });

  it('returns a finite integer for every finite value, and is deterministic', () => {
    fc.assert(
      fc.property(anyFiniteValueArb, (value) => {
        const rating = formatDisplayRating(value);

        expect(typeof rating).toBe('number');
        expect(Number.isFinite(rating)).toBe(true);
        expect(Number.isInteger(rating)).toBe(true);
        expect(formatDisplayRating(value)).toBe(rating);
      }),
      { numRuns: 600 },
    );
  });
});

// Feature: web-squads-screens, Property 20: A Display_Rating is the entry's value
// rounded half away from zero
// Validates: Requirements 8.1, 20.1
describe('formatDisplayRating — the rating renders as a plain decimal integer', () => {
  it('renders with no fractional part, no grouping separator, and no leading zero', () => {
    fc.assert(
      fc.property(safeRangeValueArb, (value) => {
        // `String(value)` is exactly how a Player_Row renders the number, so the
        // rendered form is what Requirement 8.1 constrains.
        expectRendersAsDecimalInteger(formatDisplayRating(value));
      }),
      { numRuns: 1000 },
    );
  });

  it('renders the same digits as the rounded value read back through Number', () => {
    fc.assert(
      fc.property(safeRangeValueArb, (value) => {
        const rating = formatDisplayRating(value);
        const rendered = String(rating);

        // The string is lossless: parsing it back gives the rating, so the digits
        // on screen are the rating and not a truncation of it.
        expect(Number(rendered)).toBe(rating);
        expect(rendered).toBe(rating.toFixed(0));
      }),
      { numRuns: 600 },
    );
  });

  it('inserts no grouping separator where a locale formatter would', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer({ min: 1000, max: Number.MAX_SAFE_INTEGER }),
          fc.integer({ min: -Number.MAX_SAFE_INTEGER, max: -1000 }),
          exactHalfArb.filter((half) => Math.abs(half) >= 1000),
        ),
        (value) => {
          const rating = formatDisplayRating(value);

          // The comparison is the point: a locale formatter groups these, and
          // Requirement 8.1 asks for the ungrouped form on every row whatever the
          // reader's locale.
          expect(rating.toLocaleString('en-US')).toContain(',');
          expectRendersAsDecimalInteger(rating);
        },
      ),
      { numRuns: 400 },
    );
  });

  it('renders the named boundary values as bare digit strings', () => {
    expect(String(formatDisplayRating(0.5))).toBe('1');
    expect(String(formatDisplayRating(-0.5))).toBe('-1');
    expect(String(formatDisplayRating(1.5))).toBe('2');
    expect(String(formatDisplayRating(-2.5))).toBe('-3');
    expect(String(formatDisplayRating(-0.4))).toBe('0');
    expect(String(formatDisplayRating(1000.5))).toBe('1001');
    expect(String(formatDisplayRating(Number.MAX_SAFE_INTEGER))).toBe(
      '9007199254740991',
    );
  });
});

// Feature: web-squads-screens, Property 20: a rendered rating is derived from the
// matching entry's value and from nothing else
// Validates: Requirements 8.1, 8.9
describe('selectRatingPresentation — the rating comes from the matching entry value alone', () => {
  it('yields the matching entry value rounded, whatever else the entry carries', () => {
    fc.assert(
      fc.property(
        decoratedLeaderboardArb,
        ({
          identities,
          matchIndex,
          value,
          matchDisplayName,
          decoration,
          otherValues,
          otherDecoration,
        }) => {
          const matchIdentity = identities[matchIndex];
          const entries: DisplayRatingEntry[] = identities.map((membershipId, index) =>
            index === matchIndex
              ? decorate(
                  { membershipId, displayName: matchDisplayName, value },
                  decoration,
                )
              : decorate(
                  {
                    membershipId,
                    displayName: `Player ${String(index)}`,
                    value: otherValues[index % otherValues.length],
                  },
                  otherDecoration,
                ),
          );
          const member = memberWithIdentity(matchIdentity, 'Ignored name');

          // 8.9: a rank, a mean skill estimate, an uncertainty value, a display
          // scale and offset — all present on the entry, none of them readable in
          // the answer, which is the entry's own `value` rounded and nothing else.
          expect(ratingOf(member, { entries })).toBe(roundHalfAwayFromZero(value));
        },
      ),
      { numRuns: 600 },
    );
  });

  it('gives the same rating for a decorated entry as for the bare entry', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        safeRangeValueArb,
        decorationArb,
        (membershipId, value, decoration) => {
          const bare: DisplayRatingEntry = {
            membershipId,
            displayName: 'Dave',
            value,
          };
          const member = memberWithIdentity(membershipId, 'Dave');

          // The extra properties contribute nothing: adding them is invisible in
          // the result, which is the strongest form of "disregarded".
          expect(ratingOf(member, { entries: [decorate(bare, decoration)] })).toBe(
            ratingOf(member, { entries: [bare] }),
          );
        },
      ),
      { numRuns: 600 },
    );
  });

  it('is unmoved by the other entries values, including non-finite ones', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.uuid(), { minLength: 2, maxLength: 6 }),
        safeRangeValueArb,
        fc.array(
          fc.oneof(
            safeRangeValueArb,
            fc.constantFrom(
              Number.NaN,
              Number.POSITIVE_INFINITY,
              Number.NEGATIVE_INFINITY,
              -0,
            ),
          ),
          { minLength: 5, maxLength: 5 },
        ),
        (identities, value, otherValues) => {
          const [matchIdentity, ...otherIdentities] = identities;
          const matching: DisplayRatingEntry = {
            membershipId: matchIdentity,
            displayName: 'Dave',
            value,
          };
          const others = otherIdentities.map((membershipId, index) => ({
            membershipId,
            displayName: `Other ${String(index)}`,
            value: otherValues[index % otherValues.length],
          }));
          const member = memberWithIdentity(matchIdentity, 'Dave');

          // A row's rating is its own row's business: no averaging across the
          // leaderboard, and no arrangement of the other rows changes it.
          const fromLeading = ratingOf(member, { entries: [matching, ...others] });
          const fromTrailing = ratingOf(member, { entries: [...others, matching] });

          expect(fromLeading).toBe(roundHalfAwayFromZero(value));
          expect(fromTrailing).toBe(fromLeading);
        },
      ),
      { numRuns: 600 },
    );
  });

  it('carries no field beyond the kind and the value', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        safeRangeValueArb,
        decorationArb,
        (membershipId, value, decoration) => {
          const entry = decorate(
            { membershipId, displayName: 'Dave', value },
            decoration,
          );
          const presentation = selectRatingPresentation(
            memberWithIdentity(membershipId, 'Dave'),
            { entries: [entry] },
          );

          // Nothing the entry carries can ride along to the row, because the
          // presentation has exactly two own keys.
          expect(Object.keys(presentation).sort()).toEqual(['kind', 'value']);
          expect(presentation.kind).toBe('rating');
        },
      ),
      { numRuns: 400 },
    );
  });

  it('renders the selected rating as a decimal integer on the row', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        safeRangeValueArb,
        decorationArb,
        (membershipId, value, decoration) => {
          const presentation = selectRatingPresentation(
            memberWithIdentity(membershipId, 'Dave'),
            {
              entries: [
                decorate({ membershipId, displayName: 'Dave', value }, decoration),
              ],
            },
          );

          // 8.1 end to end: a finite entry value reaches a Player_Row as bare
          // digits with an optional sign.
          expect(presentation.kind).toBe('rating');

          if (presentation.kind === 'rating') {
            expectRendersAsDecimalInteger(presentation.value);
          }
        },
      ),
      { numRuns: 600 },
    );
  });
});
