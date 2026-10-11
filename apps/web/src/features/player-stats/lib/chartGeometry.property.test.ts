// Feature: web-player-stats-screen, Property 20: Every plotted coordinate is finite and inside the drawing box
// Validates: Requirements 8.3

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { ChartExtent, ChartPlot } from './chartGeometry';
import { plotProgression } from './chartGeometry';
import type { ProgressionPoint } from './parse/playerProfile';
import { toProgressionSeries } from './progression';

/**
 * Property tests for the Chart_Geometry's containment guarantee, beside the
 * module they cover and running at or above the 100-iteration floor
 * (Requirement 14.5).
 *
 * **Property 20** is the claim Requirement 8.3 rests on: `plotProgression` is
 * total over every Progression_Series and every positive drawing extent, and
 * **never yields a non-finite coordinate**. A chart is the one panel on this
 * screen that can fail silently — a `NaN` in an SVG attribute draws nothing at
 * all, with no error anywhere — so the guarantee is asserted over generated
 * series and extents rather than over a handful of chosen ones.
 *
 * ## What "inside the drawing box" is read against
 *
 * The box is read off the requirement's own terms, not off the implementation's
 * helpers, so the assertions cannot be satisfied by a geometry that is merely
 * self-consistent. Three claims, in order of strength:
 *
 * 1. **Finite.** Every coordinate is a finite number.
 * 2. **On the surface.** Every coordinate lies between zero and the extent's
 *    length on its axis. No arrangement of a positive extent and a non-negative
 *    padding can put a point off the `viewBox` entirely.
 * 3. **Within the padding.** Where the extent leaves room on an axis — where
 *    twice the padding is less than the length — the coordinate lies between the
 *    padding and the length less the padding. Where it leaves none, the box has
 *    collapsed and the coordinate sits exactly on the axis' centre line.
 *
 * Claim 3's two cases are split on `padding × 2 < length`, which is the
 * requirement's "narrower or shorter than twice its padding" stated directly
 * rather than as the `length - padding > padding` the implementation computes.
 * The two agree on every finite pair — the subtraction is exact wherever the two
 * could disagree (Sterbenz), and a doubled padding that overflows to infinity
 * reads as collapsed under both — so this is an independent reading of the same
 * boundary rather than a looser one.
 *
 * ## The extents are deliberately hostile
 *
 * A `ChartExtent` is a component constant, so in practice it is a few hundred
 * `viewBox` units across with a sane inset. Generating only that would test
 * nothing: every interesting way to produce a non-finite coordinate involves a
 * degenerate extent. So the pool includes, as named branches:
 *
 * - the realistic extents the component actually passes;
 * - extents whose padding exceeds half the width, half the height, or both —
 *   the collapsed-box case Property 20 calls out;
 * - extents whose padding is **exactly** half the longer axis, the boundary
 *   where a `>` and a `>=` part company;
 * - very large extents, up to the largest representable length, where a span can
 *   overflow and a difference can lose every significant digit;
 * - very small extents, down to subnormal lengths, where a halved length
 *   underflows and a span can round to zero.
 *
 * Series are drawn just as widely: empty, single-point, all-instants-equal,
 * all-ratings-equal, wholly identical, and season-length, with ratings reaching
 * the finite extremes `readNumber` admits. Those degenerate *series* shapes have
 * claims of their own under Property 22; here they are inputs, and the only
 * thing asserted of them is finiteness and containment.
 *
 * ## Violations are reported, not expected one by one
 *
 * A five-hundred point series over three claims on two axes is three thousand
 * assertions per iteration, which would put these tests near the per-test
 * timeout for no benefit. {@link firstViolation} instead walks the plot and
 * answers the first offending coordinate as text, so each iteration makes one
 * assertion whose failure message names the point, the axis, the value, and the
 * claim it broke.
 */

/* -------------------------------------------------------------------------- */
/* The containment oracle                                                     */
/* -------------------------------------------------------------------------- */

/** The divisor that takes a surface's length to its centre line. */
const HALVES = 2;

/**
 * Whether an axis' padding leaves any drawing room: the requirement's "narrower
 * or shorter than twice its padding", negated.
 *
 * Stated as a doubled padding rather than a subtracted one, so the boundary is
 * read from Requirement 8.3 instead of from the implementation's arithmetic.
 */
function leavesRoom(length: number, padding: number): boolean {
  return padding * HALVES < length;
}

/**
 * The first of Property 20's three claims that a coordinate breaks, as text, or
 * `null` where it breaks none.
 *
 * @param coordinate the plotted coordinate
 * @param length the extent's length on this axis
 * @param padding the extent's padding
 * @param axis which coordinate this is, for the message
 * @param index the point's position in the series, for the message
 */
function violationOf(
  coordinate: number,
  length: number,
  padding: number,
  axis: 'x' | 'y',
  index: number,
): string | null {
  const where = `${axis} of point ${String(index)}`;
  const value = String(coordinate);

  if (!Number.isFinite(coordinate)) {
    return `${where} is not finite: ${value}`;
  }

  if (coordinate < 0 || coordinate > length) {
    return `${where} is off the surface: ${value} not within 0..${String(length)}`;
  }

  if (leavesRoom(length, padding)) {
    const high = length - padding;

    if (coordinate < padding || coordinate > high) {
      return `${where} is outside the padded box: ${value} not within ${String(padding)}..${String(high)}`;
    }

    return null;
  }

  // No room between the insets: the box is the axis' centre line.
  const centre = length / HALVES;

  if (coordinate !== centre) {
    return `${where} is off the collapsed centre line: ${value} is not ${String(centre)}`;
  }

  return null;
}

/** The first offending coordinate of a whole plot, as text, or `null`. */
function firstViolation(plot: ChartPlot, extent: ChartExtent): string | null {
  for (const [index, plotted] of plot.points.entries()) {
    const horizontal = violationOf(
      plotted.x,
      extent.width,
      extent.padding,
      'x',
      index,
    );

    if (horizontal !== null) {
      return horizontal;
    }

    const vertical = violationOf(
      plotted.y,
      extent.height,
      extent.padding,
      'y',
      index,
    );

    if (vertical !== null) {
      return vertical;
    }
  }

  return null;
}

/**
 * The first coordinate in the emitted `polyline` that is not a finite number, as
 * text, or `null`.
 *
 * The attribute is where a non-finite coordinate would actually do its damage:
 * an SVG `polyline` carrying a `NaN` draws nothing and reports nothing. The
 * printed values are rounded, so containment is not asserted here — only that
 * every one of them is a number a renderer can read.
 */
function firstNonFinitePrinted(polyline: string): string | null {
  for (const [index, pair] of polyline.split(' ').entries()) {
    const parts = pair.split(',');

    if (parts.length !== HALVES) {
      return `printed point ${String(index)} is not a coordinate pair: ${pair}`;
    }

    for (const part of parts) {
      if (part.length === 0 || !Number.isFinite(Number(part))) {
        return `printed point ${String(index)} carries a non-finite coordinate: ${pair}`;
      }
    }
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* Series generators                                                          */
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
 * carry — including a pair far enough apart that a naive span overflows.
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
 *
 * The extremes matter to this property specifically: a rating of
 * `Number.MAX_VALUE` beside one of `-Number.MAX_VALUE` is a rating domain whose
 * span overflows, and a flat series at `Number.MAX_VALUE` is one the flat-domain
 * widening cannot separate.
 */
const ratingArb: fc.Arbitrary<number> = fc.oneof(
  { weight: 6, arbitrary: fc.integer({ min: 800, max: 2_000 }) },
  {
    weight: 4,
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

/** A series whose completion instants are all the same: a zero-width time domain. */
const flatInstantSeriesArb: fc.Arbitrary<ProgressionPoint[]> = fc
  .tuple(instantArb, fc.array(ratingArb, { minLength: 1, maxLength: 16 }))
  .map(([completedAtMs, ratings]) =>
    ratings.map((displayRating) => ({ completedAtMs, displayRating })),
  );

/** A series whose Display_Ratings are all the same: a zero-height rating domain. */
const flatRatingSeriesArb: fc.Arbitrary<ProgressionPoint[]> = fc
  .tuple(ratingArb, fc.array(instantArb, { minLength: 1, maxLength: 16 }))
  .map(([displayRating, instants]) =>
    instants.map((completedAtMs) => ({ completedAtMs, displayRating })),
  );

/** A series of one point repeated: flat on both axes at once. */
const identicalSeriesArb: fc.Arbitrary<ProgressionPoint[]> = fc
  .tuple(pointArb, fc.integer({ min: 2, max: 16 }))
  .map(([point, repeats]) => Array.from({ length: repeats }, () => ({ ...point })));

/**
 * A Progression_Series as the chart might receive one: the shapes above, the
 * handful a casual squad has played, and a season-length run.
 *
 * Some branches are put through `toProgressionSeries` first, because that is
 * what the component plots; the rest are left in arrival order, because the
 * geometry promises totality over *any* series and must not depend on having
 * been handed a sorted one.
 */
const anySeriesArb: fc.Arbitrary<readonly ProgressionPoint[]> = fc.oneof(
  { weight: 1, arbitrary: fc.constant<ProgressionPoint[]>([]) },
  { weight: 2, arbitrary: fc.array(pointArb, { minLength: 1, maxLength: 1 }) },
  { weight: 5, arbitrary: fc.array(pointArb, { maxLength: 24 }) },
  {
    weight: 4,
    arbitrary: fc.array(pointArb, { maxLength: 24 }).map(toProgressionSeries),
  },
  { weight: 3, arbitrary: flatInstantSeriesArb },
  { weight: 3, arbitrary: flatRatingSeriesArb },
  { weight: 2, arbitrary: identicalSeriesArb },
  {
    weight: 1,
    arbitrary: fc
      .array(pointArb, { minLength: 60, maxLength: 120 })
      .map(toProgressionSeries),
  },
);

/** The season-length series, for the one iteration-heavy test. */
const longSeriesArb: fc.Arbitrary<readonly ProgressionPoint[]> = fc
  .array(pointArb, { minLength: 200, maxLength: 500 })
  .map(toProgressionSeries);

/* -------------------------------------------------------------------------- */
/* Extent generators                                                          */
/* -------------------------------------------------------------------------- */

/**
 * A positive, finite length on one axis: the `viewBox` sizes a component would
 * choose, the representable extremes, and everything between.
 */
const positiveLengthArb: fc.Arbitrary<number> = fc.oneof(
  { weight: 6, arbitrary: fc.double({ min: 1, max: 2_000, noNaN: true }) },
  {
    weight: 3,
    arbitrary: fc.constantFrom(
      Number.MIN_VALUE,
      Number.EPSILON,
      1e-300,
      1e-6,
      1,
      2,
      320,
      640,
      1e300,
      Number.MAX_VALUE,
    ),
  },
  {
    weight: 2,
    arbitrary: fc.double({
      min: Number.MIN_VALUE,
      max: Number.MAX_VALUE,
      noNaN: true,
    }),
  },
);

/** A non-negative, finite padding, from none at all to more than any surface. */
const nonNegativePaddingArb: fc.Arbitrary<number> = fc.oneof(
  { weight: 6, arbitrary: fc.double({ min: 0, max: 64, noNaN: true }) },
  {
    weight: 3,
    arbitrary: fc.constantFrom(
      0,
      Number.MIN_VALUE,
      1e-300,
      0.5,
      8,
      1e300,
      Number.MAX_VALUE,
    ),
  },
  {
    weight: 2,
    arbitrary: fc.double({ min: 0, max: Number.MAX_VALUE, noNaN: true }),
  },
);

/** The extents the Progression_Chart actually passes. */
const realisticExtentArb: fc.Arbitrary<ChartExtent> = fc.record({
  width: fc.double({ min: 240, max: 1_200, noNaN: true }),
  height: fc.double({ min: 120, max: 600, noNaN: true }),
  padding: fc.double({ min: 0, max: 64, noNaN: true }),
});

/** An extent whose padding leaves no room on either axis. */
const bothAxesCollapsedArb: fc.Arbitrary<ChartExtent> = fc.record({
  width: fc.double({ min: Number.MIN_VALUE, max: 100, noNaN: true }),
  height: fc.double({ min: Number.MIN_VALUE, max: 100, noNaN: true }),
  padding: fc.double({ min: 50, max: 1e6, noNaN: true }),
});

/** Tall and narrow: the horizontal box collapses, the vertical one does not. */
const widthCollapsedArb: fc.Arbitrary<ChartExtent> = fc.record({
  width: fc.double({ min: Number.MIN_VALUE, max: 40, noNaN: true }),
  height: fc.double({ min: 400, max: 2_000, noNaN: true }),
  padding: fc.double({ min: 20, max: 100, noNaN: true }),
});

/** Short and wide: the vertical box collapses, the horizontal one does not. */
const heightCollapsedArb: fc.Arbitrary<ChartExtent> = fc.record({
  width: fc.double({ min: 400, max: 2_000, noNaN: true }),
  height: fc.double({ min: Number.MIN_VALUE, max: 40, noNaN: true }),
  padding: fc.double({ min: 20, max: 100, noNaN: true }),
});

/**
 * The boundary: a padding exactly half the longer axis, so that axis' bounds
 * meet rather than cross. This is the pair on which a `>` and a `>=` disagree,
 * and it is drawn deliberately because a random padding will never land on it.
 */
const exactlyHalfPaddingArb: fc.Arbitrary<ChartExtent> = fc
  .tuple(positiveLengthArb, positiveLengthArb)
  .map(([width, height]) => ({
    width,
    height,
    padding: Math.max(width, height) / HALVES,
  }));

/** Extents at the top of the representable range. */
const veryLargeExtentArb: fc.Arbitrary<ChartExtent> = fc.record({
  width: fc.constantFrom(1e300, 1e308, Number.MAX_VALUE),
  height: fc.constantFrom(1e300, 1e308, Number.MAX_VALUE),
  padding: fc.constantFrom(0, 1, 1e299, 1e300, Number.MAX_VALUE / HALVES),
});

/** Extents at the bottom of it, down to a subnormal length. */
const verySmallExtentArb: fc.Arbitrary<ChartExtent> = fc.record({
  width: fc.constantFrom(Number.MIN_VALUE, 1e-320, 1e-300, Number.EPSILON, 1e-6),
  height: fc.constantFrom(Number.MIN_VALUE, 1e-320, 1e-300, Number.EPSILON, 1e-6),
  padding: fc.constantFrom(0, Number.MIN_VALUE, 1e-320, 1e-300, 1),
});

/** Any extent meeting the property's precondition, from every pool above. */
const anyExtentArb: fc.Arbitrary<ChartExtent> = fc.oneof(
  { weight: 6, arbitrary: realisticExtentArb },
  {
    weight: 5,
    arbitrary: fc.record({
      width: positiveLengthArb,
      height: positiveLengthArb,
      padding: nonNegativePaddingArb,
    }),
  },
  { weight: 2, arbitrary: bothAxesCollapsedArb },
  { weight: 2, arbitrary: widthCollapsedArb },
  { weight: 2, arbitrary: heightCollapsedArb },
  { weight: 2, arbitrary: exactlyHalfPaddingArb },
  { weight: 2, arbitrary: veryLargeExtentArb },
  { weight: 2, arbitrary: verySmallExtentArb },
);

/** Only the extents whose padding leaves no room on at least one axis. */
const collapsingExtentArb: fc.Arbitrary<ChartExtent> = fc.oneof(
  { weight: 3, arbitrary: bothAxesCollapsedArb },
  { weight: 2, arbitrary: widthCollapsedArb },
  { weight: 2, arbitrary: heightCollapsedArb },
  { weight: 2, arbitrary: exactlyHalfPaddingArb },
);

/* -------------------------------------------------------------------------- */
/* The property                                                               */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 20: Every plotted coordinate is finite and inside the drawing box
// Validates: Requirements 8.3
describe('every plotted coordinate is finite and inside the drawing box', () => {
  it('holds for any series on any extent with a positive width, a positive height, and a non-negative padding', () => {
    fc.assert(
      fc.property(anySeriesArb, anyExtentArb, (series, extent) => {
        expect(firstViolation(plotProgression(series, extent), extent)).toBeNull();
      }),
      { numRuns: 500 },
    );
  });

  it('yields a finite coordinate for every point, whatever the extent', () => {
    fc.assert(
      fc.property(anySeriesArb, anyExtentArb, (series, extent) => {
        // Stated on its own as well as through the oracle: a non-finite
        // coordinate is the failure that draws nothing and reports nothing, and
        // it should be legible in the output as its own broken claim.
        for (const plotted of plotProgression(series, extent).points) {
          expect(Number.isFinite(plotted.x)).toBe(true);
          expect(Number.isFinite(plotted.y)).toBe(true);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('plots one point per point of the series, so no coordinate goes unchecked', () => {
    fc.assert(
      fc.property(anySeriesArb, anyExtentArb, (series, extent) => {
        // Without this the containment claims would be vacuously true of a
        // geometry that quietly dropped the points it could not place.
        expect(plotProgression(series, extent).points).toHaveLength(series.length);
      }),
      { numRuns: 300 },
    );
  });

  it('raises nothing for any series on any extent', () => {
    fc.assert(
      fc.property(anySeriesArb, anyExtentArb, (series, extent) => {
        expect(() => plotProgression(series, extent)).not.toThrow();
      }),
      { numRuns: 300 },
    );
  });
});

// Feature: web-player-stats-screen, Property 20: Every plotted coordinate is finite and inside the drawing box
// — an extent whose padding exceeds half the width or half the height
// Validates: Requirements 8.3
describe('an extent collapsed by its padding', () => {
  it('keeps every coordinate finite and on the collapsed centre line', () => {
    fc.assert(
      fc.property(anySeriesArb, collapsingExtentArb, (series, extent) => {
        expect(firstViolation(plotProgression(series, extent), extent)).toBeNull();
      }),
      { numRuns: 400 },
    );
  });

  it('places every coordinate of a collapsed axis at the same position', () => {
    fc.assert(
      fc.property(anySeriesArb, collapsingExtentArb, (series, extent) => {
        const { points } = plotProgression(series, extent);
        const widthCollapsed = !leavesRoom(extent.width, extent.padding);
        const heightCollapsed = !leavesRoom(extent.height, extent.padding);

        for (const plotted of points) {
          if (widthCollapsed) {
            expect(plotted.x).toBe(extent.width / HALVES);
          }

          if (heightCollapsed) {
            expect(plotted.y).toBe(extent.height / HALVES);
          }
        }
      }),
      { numRuns: 300 },
    );
  });

  it('collapses rather than inverting, so no coordinate escapes the surface', () => {
    fc.assert(
      fc.property(anySeriesArb, collapsingExtentArb, (series, extent) => {
        // An inverted band — low above high — would satisfy a naive "between the
        // bounds" reading while putting coordinates outside the `viewBox`
        // altogether. This is the claim that rules that out.
        for (const plotted of plotProgression(series, extent).points) {
          expect(plotted.x).toBeGreaterThanOrEqual(0);
          expect(plotted.x).toBeLessThanOrEqual(extent.width);
          expect(plotted.y).toBeGreaterThanOrEqual(0);
          expect(plotted.y).toBeLessThanOrEqual(extent.height);
        }
      }),
      { numRuns: 300 },
    );
  });
});

// Feature: web-player-stats-screen, Property 20: Every plotted coordinate is finite and inside the drawing box
// — very large and very small extents
// Validates: Requirements 8.3
describe('an extent at the limits of what a number can express', () => {
  it('holds for the largest representable extents', () => {
    fc.assert(
      fc.property(anySeriesArb, veryLargeExtentArb, (series, extent) => {
        expect(firstViolation(plotProgression(series, extent), extent)).toBeNull();
      }),
      { numRuns: 300 },
    );
  });

  it('holds for subnormal extents, where a halved length underflows', () => {
    fc.assert(
      fc.property(anySeriesArb, verySmallExtentArb, (series, extent) => {
        expect(firstViolation(plotProgression(series, extent), extent)).toBeNull();
      }),
      { numRuns: 300 },
    );
  });

  it('holds for a padding exactly half the longer axis', () => {
    fc.assert(
      fc.property(anySeriesArb, exactlyHalfPaddingArb, (series, extent) => {
        expect(firstViolation(plotProgression(series, extent), extent)).toBeNull();
      }),
      { numRuns: 300 },
    );
  });
});

// Feature: web-player-stats-screen, Property 20: Every plotted coordinate is finite and inside the drawing box
// — the emitted polyline carries only numbers a renderer can read
// Validates: Requirements 8.3
describe('the polyline the geometry emits', () => {
  it('carries a finite coordinate pair for every plotted point', () => {
    fc.assert(
      fc.property(anySeriesArb, anyExtentArb, (series, extent) => {
        const { points, polyline } = plotProgression(series, extent);

        if (polyline === null) {
          return;
        }

        expect(firstNonFinitePrinted(polyline)).toBeNull();
        expect(polyline.split(' ')).toHaveLength(points.length);
      }),
      { numRuns: 300 },
    );
  });
});

// Feature: web-player-stats-screen, Property 20: Every plotted coordinate is finite and inside the drawing box
// — a season-length series
// Validates: Requirements 8.3
describe('a season-length series', () => {
  it('places every one of its points finitely and inside the box', () => {
    fc.assert(
      fc.property(longSeriesArb, anyExtentArb, (series, extent) => {
        const plot = plotProgression(series, extent);

        expect(plot.points).toHaveLength(series.length);
        expect(firstViolation(plot, extent)).toBeNull();
      }),
      { numRuns: 150 },
    );
  });
});
