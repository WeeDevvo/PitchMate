// Feature: web-player-stats-screen, Property 19: The progression series is a function of the input set
// Validates: Requirements 8.1

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { ProgressionPoint } from './parse/playerProfile';
import { compareProgressionPoints, toProgressionSeries } from './progression';

/**
 * Property tests for the Progression_Series derivation, beside the module they
 * cover and running at or above the 100-iteration floor (Requirement 14.5).
 *
 * **Property 19** is five claims about one pure function, and this file keeps
 * them apart so a failure names which one broke:
 *
 * 1. **Retention.** The series holds exactly the points handed in — none added,
 *    none duplicated, none lost. Retention is not a filter claim: the parser has
 *    already resolved which wire records carry a Display_Rating, and
 *    `ProgressionPoint.displayRating` is non-nullable, so there is no
 *    representable point for the derivation to drop. What is asserted is
 *    therefore that it drops nothing, which is the half of Requirement 8.1 a
 *    future "defensive" filter would quietly break.
 * 2. **The series is a function of the input *set*.** Two permutations of the
 *    same collection yield **equal** series. This is the claim the chart's
 *    determinism rests on (Requirement 8.9): the backend's row order is not
 *    promised, so a series that depended on it would render differently on two
 *    loads of the same profile.
 * 3. **Order.** The result ascends by completion instant, then by Display_Rating.
 * 4. **Idempotence.** Applying the derivation to its own output changes nothing.
 * 5. **No in-place reorder.** The caller's array — a value held in component
 *    state and read by every other panel — is left exactly as it was, and the
 *    returned array is a different array.
 *
 * ## Why equality is asserted over *values*, not references
 *
 * Clause 2 cannot be stated as reference equality. `Array.prototype.sort` is
 * stable, so two distinct point objects carrying the same instant **and** the
 * same rating come out in whichever relative order they went in — and two
 * permutations put them in differently. The comparator answers `0` for that pair
 * precisely because a `ProgressionPoint` has no third field: the two are
 * indistinguishable, and no coordinate, table row, or pixel can tell them apart.
 * So the series is compared element by element on the pair of fields a point
 * *has* ({@link valueKey}), which is the strongest equality the type admits —
 * while retention is additionally checked on **object references**, where
 * addition, duplication, and loss are detectable even among value-identical
 * points.
 *
 * Order is asserted twice over: once through `compareProgressionPoints`, as the
 * subtask asks, and once through {@link isAscendingByFields}, an independent
 * reading of "ascending by instant then by rating" that does not call the
 * comparator at all. Without the second, a comparator with its signs inverted
 * would satisfy "sorted by the comparator" perfectly.
 *
 * Negative zero is deliberately generated for both fields. `-0` and `0` compare
 * equal, and {@link valueKey} collapses them, which is the correct reading: the
 * two are the same number for every comparison this feature makes.
 */

/* -------------------------------------------------------------------------- */
/* Oracles and helpers                                                        */
/* -------------------------------------------------------------------------- */

/**
 * A point's value as a comparable key: its two fields, and nothing else.
 *
 * `-0` keys as `'0'` — the two are the same number here, and the comparator says
 * so — so a series differing only in the sign of a zero is correctly read as the
 * same series.
 */
function valueKey(point: ProgressionPoint): string {
  return `${String(point.completedAtMs)}|${String(point.displayRating)}`;
}

/** The series' values in order: the form clauses 2, 3, and 4 are compared in. */
function valueSequence(
  points: readonly ProgressionPoint[],
): readonly string[] {
  return points.map(valueKey);
}

/** How many times each key occurs, as sorted `key×count` text. */
function valueMultiset(points: readonly ProgressionPoint[]): readonly string[] {
  const counts = new Map<string, number>();

  for (const point of points) {
    const key = valueKey(point);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([key, count]) => `${key}\u00d7${String(count)}`)
    .sort();
}

/** How many times each point *object* occurs. */
function referenceMultiset(
  points: readonly ProgressionPoint[],
): Map<ProgressionPoint, number> {
  const counts = new Map<ProgressionPoint, number>();

  for (const point of points) {
    counts.set(point, (counts.get(point) ?? 0) + 1);
  }

  return counts;
}

/**
 * "Ascending by completion instant, then by Display_Rating", read straight off
 * Requirement 8.1 without calling the comparator — so the order claim is not
 * merely self-consistent with whatever the comparator happens to do.
 */
function isAscendingByFields(points: readonly ProgressionPoint[]): boolean {
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];

    if (previous.completedAtMs > current.completedAtMs) {
      return false;
    }

    if (
      previous.completedAtMs === current.completedAtMs &&
      previous.displayRating > current.displayRating
    ) {
      return false;
    }
  }

  return true;
}

/** The first index whose point the comparator places before its predecessor. */
function firstDisorderedIndex(points: readonly ProgressionPoint[]): number {
  for (let index = 1; index < points.length; index += 1) {
    if (compareProgressionPoints(points[index - 1], points[index]) > 0) {
      return index;
    }
  }

  return -1;
}

/** An array's element objects and their field values, captured before a call. */
interface ArraySnapshot {
  readonly order: readonly ProgressionPoint[];
  readonly values: readonly string[];
}

function snapshotOf(points: readonly ProgressionPoint[]): ArraySnapshot {
  return { order: [...points], values: valueSequence(points) };
}

/**
 * Asserts the array still holds the same objects in the same positions, each
 * carrying the same two field values: neither reordered in place nor written to.
 */
function expectUnchanged(
  points: readonly ProgressionPoint[],
  before: ArraySnapshot,
): void {
  expect(points).toHaveLength(before.order.length);

  for (const [index, point] of points.entries()) {
    expect(point).toBe(before.order[index]);
    expect(valueKey(point)).toBe(before.values[index]);
  }
}

/** Asserts `actual` holds exactly `expected`'s point objects, as a multiset. */
function expectSameReferences(
  actual: readonly ProgressionPoint[],
  expected: readonly ProgressionPoint[],
): void {
  const actualCounts = referenceMultiset(actual);
  const expectedCounts = referenceMultiset(expected);

  expect(actual).toHaveLength(expected.length);
  expect(actualCounts.size).toBe(expectedCounts.size);

  for (const [point, count] of expectedCounts) {
    expect(actualCounts.get(point)).toBe(count);
  }
}

/* -------------------------------------------------------------------------- */
/* Generators                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Restated from `parse/primitives`: the widest instant `readInstantMs` admits,
 * and so the widest a parsed Progression_Point can carry.
 */
const MAX_INSTANT_MS = 8_640_000_000_000_000;

/** 2020-01-01T00:00:00Z and 2030-01-01T00:00:00Z, in epoch milliseconds. */
const PLAUSIBLE_FIRST_MS = 1_577_836_800_000;
const PLAUSIBLE_LAST_MS = 1_893_456_000_000;

/**
 * A completion instant: mostly the decade a squad's matches fall in — so ties
 * and near-ties are realistic rather than astronomical — plus the small values a
 * fixture uses and the representable extremes a fuzzed body can carry.
 *
 * Whole milliseconds throughout, because that is what `readInstantMs` yields.
 */
const instantArb: fc.Arbitrary<number> = fc.oneof(
  {
    weight: 6,
    arbitrary: fc.integer({ min: PLAUSIBLE_FIRST_MS, max: PLAUSIBLE_LAST_MS }),
  },
  { weight: 3, arbitrary: fc.integer({ min: -1_000, max: 1_000 }) },
  {
    weight: 3,
    arbitrary: fc.constantFrom(
      0,
      -0,
      1,
      -1,
      MAX_INSTANT_MS,
      MAX_INSTANT_MS - 1,
      -MAX_INSTANT_MS,
    ),
  },
  {
    weight: 2,
    arbitrary: fc.integer({ min: -MAX_INSTANT_MS, max: MAX_INSTANT_MS }),
  },
);

/**
 * A Display_Rating: the band the display mapping produces, plus the fractions,
 * negatives, zeros, and finite extremes `readNumber` admits. Nothing non-finite,
 * because the reader rejects `NaN` and both infinities.
 */
const ratingArb: fc.Arbitrary<number> = fc.oneof(
  { weight: 6, arbitrary: fc.integer({ min: 800, max: 2_000 }) },
  {
    weight: 3,
    arbitrary: fc.constantFrom(
      0,
      -0,
      1,
      -1,
      1_000,
      1_000.5,
      -1_000.5,
      Number.EPSILON,
      -Number.EPSILON,
      Number.MIN_VALUE,
      -Number.MIN_VALUE,
      Number.MAX_VALUE,
      -Number.MAX_VALUE,
      Number.MAX_SAFE_INTEGER,
      Number.MIN_SAFE_INTEGER,
    ),
  },
  {
    weight: 3,
    arbitrary: fc.double({ noNaN: true, noDefaultInfinity: true }),
  },
  { weight: 2, arbitrary: fc.double({ min: 0, max: 3_000, noNaN: true }) },
);

/** One plottable point, as the parser would have produced it. */
const pointArb: fc.Arbitrary<ProgressionPoint> = fc.record({
  completedAtMs: instantArb,
  displayRating: ratingArb,
});

/**
 * Points drawn from a **small pool** of instants and a small pool of ratings, so
 * collisions are the rule rather than a coincidence: points sharing an instant
 * (the tie-break's whole reason for existing), points sharing a rating, and
 * points identical in both — the case where the comparator answers `0` and the
 * order can only be a function of the set.
 */
function tiedPointsArb(
  minLength: number,
  maxLength: number,
): fc.Arbitrary<ProgressionPoint[]> {
  return fc
    .tuple(
      fc.uniqueArray(instantArb, { minLength: 1, maxLength: 3 }),
      fc.uniqueArray(ratingArb, { minLength: 1, maxLength: 3 }),
    )
    .chain(([instants, ratings]) =>
      fc
        .array(
          fc.tuple(
            fc.nat({ max: instants.length - 1 }),
            fc.nat({ max: ratings.length - 1 }),
          ),
          { minLength, maxLength },
        )
        .map((picks) =>
          picks.map(([instantIndex, ratingIndex]) => ({
            completedAtMs: instants[instantIndex],
            displayRating: ratings[ratingIndex],
          })),
        ),
    );
}

/**
 * One point repeated as several **distinct objects** carrying identical fields,
 * shuffled in among others: the duplication a retention claim has to tell from
 * an addition.
 */
const repeatedPointsArb: fc.Arbitrary<ProgressionPoint[]> = fc
  .tuple(
    pointArb,
    fc.integer({ min: 2, max: 8 }),
    fc.array(pointArb, { maxLength: 8 }),
  )
  .chain(([point, repeats, others]) => {
    const combined: ProgressionPoint[] = [
      ...Array.from({ length: repeats }, () => ({ ...point })),
      ...others,
    ];

    return fc.shuffledSubarray(combined, {
      minLength: combined.length,
      maxLength: combined.length,
    });
  });

/**
 * A progression as it might arrive: empty, a single point, the handful a casual
 * squad has played, the tie-heavy collections above, and a season-length run.
 *
 * The empty and single-point progressions are drawn deliberately rather than
 * left to chance — they are the two conditions Requirements 8.6 and 8.7 single
 * out, and the sizes at which an ordering bug hides.
 */
const anyPointsArb: fc.Arbitrary<ProgressionPoint[]> = fc.oneof(
  { weight: 2, arbitrary: fc.array(pointArb, { maxLength: 1 }) },
  { weight: 5, arbitrary: fc.array(pointArb, { maxLength: 24 }) },
  { weight: 5, arbitrary: tiedPointsArb(0, 24) },
  { weight: 3, arbitrary: repeatedPointsArb },
  { weight: 1, arbitrary: fc.array(pointArb, { minLength: 60, maxLength: 120 }) },
);

/** The 500-point progression: a squad half a decade in, ties and all. */
const fiveHundredPointsArb: fc.Arbitrary<ProgressionPoint[]> = fc.oneof(
  { weight: 1, arbitrary: fc.array(pointArb, { minLength: 500, maxLength: 500 }) },
  { weight: 1, arbitrary: tiedPointsArb(500, 500) },
);

/** A permutation of the very same point objects. */
function permutationArb(
  points: readonly ProgressionPoint[],
): fc.Arbitrary<ProgressionPoint[]> {
  if (points.length === 0) {
    return fc.constant<ProgressionPoint[]>([]);
  }

  const source = [...points];

  return fc.shuffledSubarray(source, {
    minLength: source.length,
    maxLength: source.length,
  });
}

/** A collection and a permutation of it, for the clause-2 claims. */
const permutationPairArb: fc.Arbitrary<
  readonly [ProgressionPoint[], ProgressionPoint[]]
> = anyPointsArb.chain((points) =>
  permutationArb(points).map(
    (permuted) => [points, permuted] as readonly [ProgressionPoint[], ProgressionPoint[]],
  ),
);

/* -------------------------------------------------------------------------- */
/* Clause 1: retention                                                        */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 19: The progression series is a function of the input set
// — the series retains exactly the points handed in
// Validates: Requirements 8.1
describe('the progression series retains exactly the points handed in', () => {
  it('adds nothing, duplicates nothing, and loses nothing', () => {
    fc.assert(
      fc.property(anyPointsArb, (points) => {
        const series = toProgressionSeries(points);

        // References, so duplication and loss are detectable even among points
        // that carry identical fields.
        expectSameReferences(series, points);
        // Values, so a point rewritten in passing would show up too.
        expect(valueMultiset(series)).toEqual(valueMultiset(points));
      }),
      { numRuns: 500 },
    );
  });

  it('filters nothing, because a point without a display rating is not a point', () => {
    fc.assert(
      fc.property(anyPointsArb, (points) => {
        // `displayRating` is non-nullable: the parser contributes no point for a
        // wire record that carries none, so there is nothing here to filter and
        // the length is preserved exactly.
        expect(toProgressionSeries(points)).toHaveLength(points.length);
      }),
      { numRuns: 300 },
    );
  });

  it('yields an empty series for an empty progression', () => {
    const series = toProgressionSeries([]);

    expect(series).toEqual([]);
  });

  it('yields the one point of a single-point progression', () => {
    fc.assert(
      fc.property(pointArb, (point) => {
        const series = toProgressionSeries([point]);

        expect(series).toHaveLength(1);
        expect(series[0]).toBe(point);
      }),
      { numRuns: 200 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Clause 2: a function of the input set                                      */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 19: The progression series is a function of the input set
// — two permutations of one collection yield equal series
// Validates: Requirements 8.1
describe('the progression series is a function of the input set', () => {
  it('yields equal series for two permutations of the same points', () => {
    fc.assert(
      fc.property(permutationPairArb, ([points, permuted]) => {
        // Values, not references: two distinct objects identical in both fields
        // compare equal, and a stable sort leaves them in arrival order — which
        // is exactly the difference between the two inputs here. Equality on the
        // fields a point has is the strongest the type admits.
        expect(valueSequence(toProgressionSeries(permuted))).toEqual(
          valueSequence(toProgressionSeries(points)),
        );
      }),
      { numRuns: 500 },
    );
  });

  it('yields the same series on repeated calls with the same collection', () => {
    fc.assert(
      fc.property(anyPointsArb, (points) => {
        expect(valueSequence(toProgressionSeries(points))).toEqual(
          valueSequence(toProgressionSeries(points)),
        );
      }),
      { numRuns: 300 },
    );
  });

  it('yields equal series for a reversed collection', () => {
    fc.assert(
      fc.property(anyPointsArb, (points) => {
        // The permutation most likely to expose a comparator that defers to
        // arrival order, drawn deliberately rather than left to the shuffle.
        expect(valueSequence(toProgressionSeries([...points].reverse()))).toEqual(
          valueSequence(toProgressionSeries(points)),
        );
      }),
      { numRuns: 300 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Clause 3: the order                                                        */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 19: The progression series is a function of the input set
// — the series is in comparator order
// Validates: Requirements 8.1
describe('the progression series is sorted by the comparator', () => {
  it('places no point before its predecessor', () => {
    fc.assert(
      fc.property(anyPointsArb, (points) => {
        const series = toProgressionSeries(points);

        expect(firstDisorderedIndex(series)).toBe(-1);
      }),
      { numRuns: 500 },
    );
  });

  it('ascends by completion instant, then by display rating', () => {
    fc.assert(
      fc.property(anyPointsArb, (points) => {
        // Read off Requirement 8.1 without the comparator, so "sorted" cannot be
        // satisfied by a comparator that is itself wrong.
        expect(isAscendingByFields(toProgressionSeries(points))).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it('orders by a total comparator, so ties cannot defer to arrival order', () => {
    fc.assert(
      fc.property(pointArb, pointArb, pointArb, (left, middle, right) => {
        const leftRight = compareProgressionPoints(left, right);

        // Antisymmetric, and three-valued. The reversed expectation is written
        // out rather than negated, because `-0` is not `0` to `toBe`.
        expect([-1, 0, 1]).toContain(leftRight);
        expect(compareProgressionPoints(right, left)).toBe(
          leftRight === 0 ? 0 : -leftRight,
        );
        expect(compareProgressionPoints(left, left)).toBe(0);

        // `0` only for points indistinguishable in both fields.
        expect(leftRight === 0).toBe(valueKey(left) === valueKey(right));

        // Transitive: no cycle can make the sorted order input-dependent.
        const leftMiddle = compareProgressionPoints(left, middle);
        const middleRight = compareProgressionPoints(middle, right);

        if (leftMiddle <= 0 && middleRight <= 0) {
          expect(leftRight).toBeLessThanOrEqual(0);
        }
      }),
      { numRuns: 500 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Clause 4: idempotence                                                      */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 19: The progression series is a function of the input set
// — applying the derivation to its own output changes nothing
// Validates: Requirements 8.1
describe('deriving the series from a series changes nothing', () => {
  it('is idempotent', () => {
    fc.assert(
      fc.property(anyPointsArb, (points) => {
        const once = toProgressionSeries(points);
        const twice = toProgressionSeries(once);

        expect(valueSequence(twice)).toEqual(valueSequence(once));
        expectSameReferences(twice, once);
      }),
      { numRuns: 500 },
    );
  });

  it('is unchanged by a third and fourth application', () => {
    fc.assert(
      fc.property(anyPointsArb, (points) => {
        const settled = toProgressionSeries(toProgressionSeries(points));

        expect(
          valueSequence(toProgressionSeries(toProgressionSeries(settled))),
        ).toEqual(valueSequence(settled));
      }),
      { numRuns: 200 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Clause 5: the caller's collection is untouched                             */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 19: The progression series is a function of the input set
// — the input collection is not reordered in place
// Validates: Requirements 8.1
describe('the progression the series was derived from is left alone', () => {
  it('leaves the input array holding the same objects in the same order', () => {
    fc.assert(
      fc.property(anyPointsArb, (points) => {
        const before = snapshotOf(points);

        toProgressionSeries(points);

        // `sort` reorders in place, and this array belongs to the parsed profile
        // every other panel reads. Copying first is what keeps the derivation a
        // function rather than a side effect.
        expectUnchanged(points, before);
      }),
      { numRuns: 500 },
    );
  });

  it('returns an array of its own', () => {
    fc.assert(
      fc.property(anyPointsArb, (points) => {
        expect(toProgressionSeries(points)).not.toBe(points);
      }),
      { numRuns: 200 },
    );
  });

  it('leaves the input alone across repeated derivations', () => {
    fc.assert(
      fc.property(anyPointsArb, (points) => {
        const before = snapshotOf(points);

        toProgressionSeries(points);
        toProgressionSeries(points);
        toProgressionSeries(toProgressionSeries(points));

        expectUnchanged(points, before);
      }),
      { numRuns: 200 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* All five clauses at five hundred points                                    */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 19: The progression series is a function of the input set
// — every clause at five hundred points
// Validates: Requirements 8.1
describe('a five-hundred point progression', () => {
  it('satisfies every clause of the property', () => {
    fc.assert(
      fc.property(fiveHundredPointsArb, (points) => {
        const before = snapshotOf(points);
        const series = toProgressionSeries(points);

        // Retention.
        expectSameReferences(series, points);
        expect(series).toHaveLength(500);

        // Order, both readings.
        expect(firstDisorderedIndex(series)).toBe(-1);
        expect(isAscendingByFields(series)).toBe(true);

        // Idempotence.
        expect(valueSequence(toProgressionSeries(series))).toEqual(
          valueSequence(series),
        );

        // The input untouched.
        expectUnchanged(points, before);
      }),
      { numRuns: 100 },
    );
  });

  it('yields the same series from a permutation of its points', () => {
    fc.assert(
      fc.property(
        fiveHundredPointsArb.chain((points) =>
          permutationArb(points).map(
            (permuted) =>
              [points, permuted] as readonly [
                ProgressionPoint[],
                ProgressionPoint[],
              ],
          ),
        ),
        ([points, permuted]) => {
          expect(valueSequence(toProgressionSeries(permuted))).toEqual(
            valueSequence(toProgressionSeries(points)),
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});
