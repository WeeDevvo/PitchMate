// Feature: web-player-stats-screen, Property 21: The plot preserves the series order
// Validates: Requirements 8.3

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  plotProgression,
  type ChartExtent,
  type ChartPlot,
} from './chartGeometry';
import type { ProgressionPoint } from './parse/playerProfile';
import { toProgressionSeries } from './progression';

/**
 * Property tests for the order half of the Chart_Geometry, beside the module
 * they cover and running at or above the 100-iteration floor.
 *
 * **Property 21** reads as two claims about `plotProgression`, and this file
 * keeps them apart so a failure names which one broke:
 *
 * 1. **The plot is in the series' order, point for point.** One plotted point
 *    per series point, in the same positions, each carrying the very point it
 *    was derived from. Plotting therefore neither re-sorts nor filters: the
 *    ordering is `toProgressionSeries`' business (Requirement 8.1), and a
 *    geometry that quietly sorted again would make the chart a plot of a
 *    different series than the Progression_Table lists beside it.
 * 2. **The horizontal coordinates are non-decreasing** across a series in
 *    `toProgressionSeries` order — which is the visible consequence: time runs
 *    left to right, so a later match never plots to the left of an earlier one.
 *
 * ## Why the second claim is tested through the real derivation
 *
 * The non-decreasing claim only means anything for an *ordered* series, so the
 * generator feeds `plotProgression` the output of `toProgressionSeries` rather
 * than an array a generator happened to sort. Any divergence between "ordered"
 * as this test means it and "ordered" as the screen produces it would otherwise
 * leave the real composition untested. The same series is additionally plotted
 * **unordered** to assert claim 1 holds there too: that is where re-sorting
 * inside the geometry would show up, since an already-ordered input makes a
 * re-sort invisible.
 *
 * Monotonicity is asserted in its sharper form as well: within one plot, two
 * points sharing a completion instant get the **same** horizontal coordinate,
 * and a point with an earlier instant never gets a larger one. Those two
 * together imply the non-decreasing claim and pin down *why* it holds — `x` is
 * a non-decreasing function of the instant — rather than letting it pass by
 * coincidence on a generated run where all instants happened to be distinct.
 *
 * A third, closely related claim earns its place here: each point's coordinates
 * depend on the point and on the series' **set**, not on the point's position.
 * Both axis domains are folds of minima and maxima, so permuting the input must
 * move the plotted points around without changing any coordinate — and that is
 * what makes "the plot is in the series' order" a statement about ordering
 * alone rather than about scaling.
 *
 * Coordinates are compared through {@link normaliseZero}, because `-0` and `0`
 * are the same coordinate to every reader of this plot while `toBe`
 * distinguishes them. Order comparisons use `<=` directly, which already reads
 * the two as equal.
 *
 * The extent generators cover the collapsed box — an extent narrower or shorter
 * than twice its padding — because that is the case where every coordinate
 * lands on one value, and a monotonicity test written only for roomy extents
 * would never exercise the equality half of "non-decreasing".
 */

/* -------------------------------------------------------------------------- */
/* Oracles and helpers                                                        */
/* -------------------------------------------------------------------------- */

/** `-0` read as the coordinate it is: the same one as `0`. */
function normaliseZero(value: number): number {
  return value === 0 ? 0 : value;
}

/** A point's value as a comparable key: its two fields, and nothing else. */
function valueKey(point: ProgressionPoint): string {
  return `${String(normaliseZero(point.completedAtMs))}|${String(normaliseZero(point.displayRating))}`;
}

/** A plotted point's coordinates as a comparable key. */
function coordinateKey(x: number, y: number): string {
  return `${String(normaliseZero(x))}|${String(normaliseZero(y))}`;
}

/**
 * The first index whose horizontal coordinate sits left of its predecessor's,
 * or `-1` where none does.
 *
 * `<=` reads `-0` and `0` as equal, which is the correct reading: a coordinate
 * of `-0` is the same position as `0`.
 */
function firstDecreasingIndex(plot: ChartPlot): number {
  for (let index = 1; index < plot.points.length; index += 1) {
    const previous = plot.points[index - 1];
    const current = plot.points[index];

    if (!(previous.x <= current.x)) {
      return index;
    }
  }

  return -1;
}

/**
 * Asserts the plot holds one point per series point, in the same positions,
 * each carrying the point it came from — by reference, so a rebuilt-but-equal
 * point is caught, and by value, so a point rewritten in passing is too.
 */
function expectPlottedInOrder(
  plot: ChartPlot,
  series: readonly ProgressionPoint[],
): void {
  expect(plot.points).toHaveLength(series.length);

  for (const [index, plotted] of plot.points.entries()) {
    expect(plotted.point).toBe(series[index]);
    expect(valueKey(plotted.point)).toBe(valueKey(series[index]));
  }
}

/**
 * Each point's coordinates in one plot, keyed by the point object.
 *
 * Keyed by reference rather than by value, because a series may hold several
 * points identical in both fields and they must each be accounted for.
 */
function coordinatesByPoint(plot: ChartPlot): Map<ProgressionPoint, string> {
  const coordinates = new Map<ProgressionPoint, string>();

  for (const plotted of plot.points) {
    coordinates.set(plotted.point, coordinateKey(plotted.x, plotted.y));
  }

  return coordinates;
}

/**
 * The `polyline` attribute read back as pairs of numbers.
 *
 * The attribute's rounding is the geometry's business, so nothing here
 * reproduces it; the horizontal readings are compared against the plotted
 * coordinates within {@link POLYLINE_TOLERANCE} and otherwise only for their
 * order.
 */
function readPolyline(polyline: string): readonly { x: number; y: number }[] {
  return polyline.split(' ').map((token) => {
    const [x, y] = token.split(',');

    return { x: Number(x), y: Number(y) };
  });
}

/**
 * How far a `polyline` reading may sit from the coordinate it was printed
 * from: half of the last decimal place the geometry keeps, plus a margin for
 * the decimal-to-binary round trip.
 */
const POLYLINE_TOLERANCE = 0.001;

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
 * A completion instant: mostly the decade a squad's matches fall in, plus the
 * small values a fixture uses and the representable extremes a fuzzed body can
 * carry. Whole milliseconds throughout, because that is what `readInstantMs`
 * yields.
 */
const instantArb: fc.Arbitrary<number> = fc.oneof(
  {
    weight: 6,
    arbitrary: fc.integer({ min: PLAUSIBLE_FIRST_MS, max: PLAUSIBLE_LAST_MS }),
  },
  { weight: 3, arbitrary: fc.integer({ min: -1_000, max: 1_000 }) },
  {
    weight: 2,
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
 * negatives, zeros, and finite extremes `readNumber` admits. Nothing
 * non-finite, because the reader rejects `NaN` and both infinities.
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
      Number.MAX_VALUE,
      -Number.MAX_VALUE,
      Number.MAX_SAFE_INTEGER,
      Number.MIN_SAFE_INTEGER,
    ),
  },
  { weight: 3, arbitrary: fc.double({ noNaN: true, noDefaultInfinity: true }) },
);

/** One plottable point, as the parser would have produced it. */
const pointArb: fc.Arbitrary<ProgressionPoint> = fc.record({
  completedAtMs: instantArb,
  displayRating: ratingArb,
});

/**
 * Points drawn from a **small pool** of instants and ratings, so collisions are
 * the rule rather than a coincidence: points sharing an instant — the case the
 * sharper monotonicity claim is about — points sharing a rating, and points
 * identical in both.
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
 * A progression as it might arrive: empty, a single point, the handful a casual
 * squad has played, the tie-heavy collections above, and a season-length run.
 *
 * The empty and single-point progressions are drawn deliberately rather than
 * left to chance — they are the two sizes at which an order claim is vacuous,
 * and so the two the function is most likely to get wrong unnoticed.
 */
const anyPointsArb: fc.Arbitrary<ProgressionPoint[]> = fc.oneof(
  { weight: 2, arbitrary: fc.array(pointArb, { maxLength: 1 }) },
  { weight: 5, arbitrary: fc.array(pointArb, { maxLength: 24 }) },
  { weight: 5, arbitrary: tiedPointsArb(0, 24) },
  { weight: 1, arbitrary: fc.array(pointArb, { minLength: 60, maxLength: 120 }) },
);

/** The 500-point progression: a squad half a decade in, ties and all. */
const fiveHundredPointsArb: fc.Arbitrary<ProgressionPoint[]> = fc.oneof(
  {
    weight: 1,
    arbitrary: fc.array(pointArb, { minLength: 500, maxLength: 500 }),
  },
  { weight: 1, arbitrary: tiedPointsArb(500, 500) },
);

/**
 * The extents drawn deliberately rather than left to chance: the component's
 * own constant, the one-unit surface, the surface exactly twice its padding
 * (the boundary at which the box collapses), and the representable extremes.
 */
const FIXED_EXTENTS: ChartExtent[] = [
  { width: 640, height: 240, padding: 24 },
  { width: 1, height: 1, padding: 0 },
  { width: 2, height: 2, padding: 1 },
  { width: Number.MAX_VALUE, height: Number.MAX_VALUE, padding: 0 },
  { width: Number.MIN_VALUE, height: Number.MIN_VALUE, padding: 0 },
];

/**
 * A drawing extent within the contract: a positive width, a positive height,
 * and a non-negative padding.
 *
 * Deliberately includes the extents whose padding exceeds half the width or
 * half the height — where the drawing box collapses to its centre line and
 * every coordinate lands on one value — so the equality half of
 * "non-decreasing" is exercised rather than assumed.
 */
const extentArb: fc.Arbitrary<ChartExtent> = fc.oneof(
  {
    weight: 6,
    arbitrary: fc.record({
      width: fc.integer({ min: 200, max: 1_200 }),
      height: fc.integer({ min: 100, max: 600 }),
      padding: fc.integer({ min: 0, max: 48 }),
    }),
  },
  {
    weight: 3,
    arbitrary: fc.record({
      // Padding beyond half the surface: the collapsed box.
      width: fc.integer({ min: 1, max: 40 }),
      height: fc.integer({ min: 1, max: 40 }),
      padding: fc.integer({ min: 20, max: 500 }),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      width: fc.double({ min: Number.MIN_VALUE, max: 1e9, noNaN: true }),
      height: fc.double({ min: Number.MIN_VALUE, max: 1e9, noNaN: true }),
      padding: fc.double({ min: 0, max: 1e9, noNaN: true }),
    }),
  },
  { weight: 1, arbitrary: fc.constantFrom(...FIXED_EXTENTS) },
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

/* -------------------------------------------------------------------------- */
/* Claim 1: the plot is in the series' order, point for point                 */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 21: The plot preserves the series order
// — one plotted point per series point, in the series' positions
// Validates: Requirements 8.3
describe('the plot holds the series points in the series order', () => {
  it('plots one point per series point, each carrying that point', () => {
    fc.assert(
      fc.property(anyPointsArb, extentArb, (points, extent) => {
        const series = toProgressionSeries(points);

        expectPlottedInOrder(plotProgression(series, extent), series);
      }),
      { numRuns: 300 },
    );
  });

  it('neither re-sorts nor filters a series handed over out of order', () => {
    fc.assert(
      fc.property(
        anyPointsArb.chain((points) =>
          permutationArb(points).map(
            (permuted) =>
              [points, permuted] as readonly [
                ProgressionPoint[],
                ProgressionPoint[],
              ],
          ),
        ),
        extentArb,
        ([, permuted], extent) => {
          // Ordering is `toProgressionSeries`' business. A caller that skipped
          // it gets a plot of what it actually passed, which is where a re-sort
          // inside the geometry would show up — an ordered input hides one.
          expectPlottedInOrder(plotProgression(permuted, extent), permuted);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('plots nothing for an empty series', () => {
    fc.assert(
      fc.property(extentArb, (extent) => {
        const plot = plotProgression([], extent);

        expect(plot.points).toEqual([]);
        expect(plot.polyline).toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  it('plots the one point of a single-point series', () => {
    fc.assert(
      fc.property(pointArb, extentArb, (point, extent) => {
        const plot = plotProgression([point], extent);

        expect(plot.points).toHaveLength(1);
        expect(plot.points[0].point).toBe(point);
      }),
      { numRuns: 200 },
    );
  });

  it('lists the polyline points in the plotted order', () => {
    fc.assert(
      fc.property(anyPointsArb, extentArb, (points, extent) => {
        const series = toProgressionSeries(points);
        const plot = plotProgression(series, extent);

        if (plot.polyline === null) {
          // Exactly the empty and single-point series, which have no line.
          expect(plot.points.length).toBeLessThan(2);

          return;
        }

        const printed = readPolyline(plot.polyline);

        expect(printed).toHaveLength(plot.points.length);

        for (const [index, pair] of printed.entries()) {
          // The attribute's rounding belongs to the geometry; what is asserted
          // is that point `index` of the line is point `index` of the plot.
          expect(Math.abs(pair.x - plot.points[index].x)).toBeLessThanOrEqual(
            POLYLINE_TOLERANCE,
          );
        }
      }),
      { numRuns: 200 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Claim 2: the horizontal coordinates are non-decreasing                     */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 21: The plot preserves the series order
// — time runs left to right across an ordered series
// Validates: Requirements 8.3
describe('the horizontal coordinates of an ordered series are non-decreasing', () => {
  it('never plots a later match to the left of an earlier one', () => {
    fc.assert(
      fc.property(anyPointsArb, extentArb, (points, extent) => {
        // Fed through the real derivation, so "ordered" means what the screen
        // means by it rather than what this test might assume.
        const plot = plotProgression(toProgressionSeries(points), extent);

        expect(firstDecreasingIndex(plot)).toBe(-1);
      }),
      { numRuns: 300 },
    );
  });

  it('places two points sharing an instant at the same horizontal coordinate', () => {
    fc.assert(
      fc.property(tiedPointsArb(0, 24), extentArb, (points, extent) => {
        const plot = plotProgression(toProgressionSeries(points), extent);
        const byInstant = new Map<number, number>();

        for (const plotted of plot.points) {
          const instant = normaliseZero(plotted.point.completedAtMs);
          const seen = byInstant.get(instant);

          if (seen === undefined) {
            byInstant.set(instant, normaliseZero(plotted.x));
          } else {
            // `x` is a function of the instant, not of the rating or the
            // position: equal instants must land on one coordinate.
            expect(normaliseZero(plotted.x)).toBe(seen);
          }
        }
      }),
      { numRuns: 300 },
    );
  });

  it('is non-decreasing in the instant across every pair of plotted points', () => {
    fc.assert(
      fc.property(anyPointsArb, extentArb, (points, extent) => {
        const plot = plotProgression(toProgressionSeries(points), extent);

        for (let index = 1; index < plot.points.length; index += 1) {
          const previous = plot.points[index - 1];
          const current = plot.points[index];

          // The pairwise reading of the same claim, stated against the instants
          // rather than against the positions: an earlier instant never plots
          // to the right.
          if (previous.point.completedAtMs < current.point.completedAtMs) {
            expect(previous.x).toBeLessThanOrEqual(current.x);
          } else {
            expect(normaliseZero(previous.x)).toBe(normaliseZero(current.x));
          }
        }
      }),
      { numRuns: 300 },
    );
  });

  it('reads the polyline left to right for an ordered series', () => {
    fc.assert(
      fc.property(anyPointsArb, extentArb, (points, extent) => {
        const plot = plotProgression(toProgressionSeries(points), extent);

        if (plot.polyline === null) {
          return;
        }

        const printed = readPolyline(plot.polyline);

        for (let index = 1; index < printed.length; index += 1) {
          expect(printed[index - 1].x).toBeLessThanOrEqual(printed[index].x);
        }
      }),
      { numRuns: 200 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* The coordinates depend on the point and the set, not on the position       */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 21: The plot preserves the series order
// — permuting the series moves the points, never their coordinates
// Validates: Requirements 8.3
describe('a point keeps its coordinates under any ordering of the series', () => {
  it('yields the same coordinates for each point from a permuted series', () => {
    fc.assert(
      fc.property(
        anyPointsArb.chain((points) =>
          permutationArb(points).map(
            (permuted) =>
              [points, permuted] as readonly [
                ProgressionPoint[],
                ProgressionPoint[],
              ],
          ),
        ),
        extentArb,
        ([points, permuted], extent) => {
          // Both axis domains are folds of minima and maxima, so they are
          // functions of the set. Order therefore decides where a point appears
          // in the plot, never where it appears on the surface.
          const ordered = coordinatesByPoint(
            plotProgression(toProgressionSeries(points), extent),
          );
          const shuffled = coordinatesByPoint(
            plotProgression(toProgressionSeries(permuted), extent),
          );

          expect(shuffled.size).toBe(ordered.size);

          for (const [point, coordinates] of ordered) {
            expect(shuffled.get(point)).toBe(coordinates);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it('leaves the series array it was handed exactly as it was', () => {
    fc.assert(
      fc.property(anyPointsArb, extentArb, (points, extent) => {
        const before = [...points];

        plotProgression(points, extent);

        expect(points).toHaveLength(before.length);

        for (const [index, point] of points.entries()) {
          expect(point).toBe(before[index]);
        }
      }),
      { numRuns: 200 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Both claims at five hundred points                                         */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 21: The plot preserves the series order
// — both claims at five hundred points
// Validates: Requirements 8.3
describe('a five-hundred point series', () => {
  it('plots in order with non-decreasing horizontal coordinates', () => {
    fc.assert(
      fc.property(fiveHundredPointsArb, extentArb, (points, extent) => {
        const series = toProgressionSeries(points);
        const plot = plotProgression(series, extent);

        expectPlottedInOrder(plot, series);
        expect(plot.points).toHaveLength(500);
        expect(firstDecreasingIndex(plot)).toBe(-1);
      }),
      { numRuns: 100 },
    );
  });
});
