// Feature: web-player-stats-screen, Property 22: Every degenerate series plots without failing
// Validates: Requirements 8.6, 8.7, 8.8

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { plotProgression, type ChartExtent, type ChartPlot } from './chartGeometry';
import type { ProgressionPoint } from './parse/playerProfile';

/**
 * Property tests for the Chart_Geometry's degenerate cases, beside the module
 * they cover and running at or above the 100-iteration floor (Requirement 14.5).
 *
 * A rating history is short, flat, or absent far more often than it is a tidy
 * upward curve, and every one of those shapes is a zero-width or zero-height
 * domain waiting to divide. **Property 22** is therefore asserted over the
 * shapes themselves rather than over arbitrary series: the empty series, every
 * single-point series, series whose instants are all equal, series whose
 * Display_Ratings are all equal — including all-zero and all-negative — and
 * extents whose padding leaves no drawing box at all. Each family is generated
 * deliberately, because a uniform generator would reach them only by accident.
 *
 * Three claims are made of every one of them:
 *
 * 1. **No coordinate is non-finite.** Every `x`, every `y`, and every number in
 *    the emitted `polyline` is a finite number inside the drawing box
 *    (Requirement 8.3, as it bears on 8.6–8.8).
 * 2. **Nothing is scaled against a zero-height or zero-width domain.** The
 *    division itself is private, so what is asserted are its two observable
 *    consequences: the reported rating domain has **positive height** wherever
 *    widening can be represented (Requirement 8.8), and a domain that genuinely
 *    has no extent — all instants equal, a rating too large for widening to
 *    separate — resolves to the band's **centre line** rather than to `NaN`.
 * 3. **The polyline is present for exactly the series of two or more points.**
 *    `null` for the empty series (Requirement 8.6) and for the single-point
 *    series (Requirement 8.7), a string otherwise — so a single reading has no
 *    line string a component could render as a trend.
 *
 * ## Why the centre line is asserted rather than merely finiteness
 *
 * "Did not fail" is too weak a reading of Requirement 8.8. A geometry that
 * clamped every flat history to the top of the box would satisfy finiteness
 * while drawing a flat run of 1 400s pinned against the axis. The requirement's
 * "renders as a flat line" is a statement about where the line goes, and the
 * implementation gets there by widening the *domain* symmetrically — so the
 * centring is the property, and it is checked for the flat-rating, equal-instant,
 * and single-point families alike.
 *
 * ## The expected band is re-derived, not read back
 *
 * {@link expectedBand} states where the drawing box is from the extent alone —
 * including the collapse to a centre line when the padding leaves no room —
 * rather than inferring it from the coordinates the geometry returned. An oracle
 * read back off the output would agree with any output.
 */

/* -------------------------------------------------------------------------- */
/* Restated constants                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Restated from `chartGeometry`: how far either side of a flat rating domain is
 * widened.
 *
 * Needed only to say *when* widening can be expected to separate the bounds at
 * all — for a Display_Rating so large that adding half a unit does not change
 * it, the domain stays flat and the centre-line rule takes over. No parsed
 * rating is remotely near that; the generators reach it anyway.
 */
const FLAT_DOMAIN_MARGIN = 0.5;

/**
 * Restated from `parse/primitives`: the widest instant `readInstantMs` admits,
 * and so the widest a parsed Progression_Point can carry.
 */
const MAX_INSTANT_MS = 8_640_000_000_000_000;

/** 2020-01-01T00:00:00Z and 2030-01-01T00:00:00Z, in epoch milliseconds. */
const PLAUSIBLE_FIRST_MS = 1_577_836_800_000;
const PLAUSIBLE_LAST_MS = 1_893_456_000_000;

/** Decimal places the `polyline` attribute is rounded to, restated. */
const COORDINATE_DECIMALS = 3;

/** How far a printed coordinate may sit from the one it was printed from. */
const PRINT_TOLERANCE = 0.5 * 10 ** -COORDINATE_DECIMALS + Number.EPSILON;

/** The divisor that takes a band's length to its centre line. */
const HALVES = 2;

/** The number of points below which there is no line segment to draw. */
const MINIMUM_LINE_POINTS = 2;

/* -------------------------------------------------------------------------- */
/* Oracles and helpers                                                        */
/* -------------------------------------------------------------------------- */

/** A closed interval on one axis of the drawing surface. */
interface Band {
  readonly low: number;
  readonly high: number;
}

/**
 * Where the drawing box sits on one axis, from the extent alone (Requirement
 * 8.3).
 *
 * Where the insets leave no room — a surface no longer than twice its padding,
 * the collapsed extent this property calls out — the band is the surface's
 * centre line rather than an inverted interval, because an inverted interval
 * would put coordinates outside the box while still passing a naive
 * between-the-bounds test.
 */
function expectedBand(length: number, padding: number): Band {
  const low = padding;
  const high = length - padding;

  if (high > low) {
    return { low, high };
  }

  const collapsed = length / HALVES;

  return { low: collapsed, high: collapsed };
}

/** The coordinate halfway along a band. */
function centreOf(band: Band): number {
  return band.low + (band.high - band.low) / HALVES;
}

/**
 * How far from an expected coordinate an actual one may fall.
 *
 * The fraction a centring goes through is computed from the rating domain, so it
 * carries relative floating-point error; scaled by the band's length, that is
 * what the tolerance allows for. Generous by fifteen orders of magnitude over
 * the error itself, and still far tighter than a device pixel.
 */
function centreTolerance(band: Band): number {
  return Math.max(Number.EPSILON, Math.abs(band.high - band.low) * 1e-9);
}

/** Asserts a finite coordinate within `tolerance` of where it was expected. */
function expectNear(actual: number, expected: number, tolerance: number): void {
  expect(Number.isFinite(actual)).toBe(true);
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

/** The horizontal and vertical bands one extent yields. */
function bandsOf(extent: ChartExtent): { horizontal: Band; vertical: Band } {
  return {
    horizontal: expectedBand(extent.width, extent.padding),
    vertical: expectedBand(extent.height, extent.padding),
  };
}

/** The `x,y` pairs of a `polyline` attribute, as numbers. */
function readPolyline(polyline: string): readonly (readonly number[])[] {
  return polyline
    .split(' ')
    .map((pair) => pair.split(',').map((coordinate) => Number(coordinate)));
}

/**
 * The three claims of Property 22 that every family shares: finite coordinates
 * inside the drawing box, a finite and ordered rating domain, and a `polyline`
 * present for exactly the series of two or more points.
 *
 * Also checks the points come back one per input point, carrying the point they
 * were derived from — a geometry that dropped the degenerate cases rather than
 * plotting them would otherwise satisfy everything else here.
 */
function expectWellFormedPlot(
  plot: ChartPlot,
  series: readonly ProgressionPoint[],
  extent: ChartExtent,
): void {
  const { horizontal, vertical } = bandsOf(extent);

  expect(plot.points).toHaveLength(series.length);

  for (const [index, plotted] of plot.points.entries()) {
    expect(plotted.point).toBe(series[index]);

    expect(Number.isFinite(plotted.x)).toBe(true);
    expect(Number.isFinite(plotted.y)).toBe(true);

    expect(plotted.x).toBeGreaterThanOrEqual(horizontal.low);
    expect(plotted.x).toBeLessThanOrEqual(horizontal.high);
    expect(plotted.y).toBeGreaterThanOrEqual(vertical.low);
    expect(plotted.y).toBeLessThanOrEqual(vertical.high);
  }

  // The rating domain the vertical axis was scaled from: finite and ordered in
  // every case, including the empty series that is never drawn.
  expect(Number.isFinite(plot.ratingFloor)).toBe(true);
  expect(Number.isFinite(plot.ratingCeiling)).toBe(true);
  expect(plot.ratingCeiling).toBeGreaterThanOrEqual(plot.ratingFloor);

  expectPolylineMatchesPoints(plot);
}

/**
 * Asserts the emitted line is `null` for exactly the series of fewer than two
 * points, and otherwise prints every point once, in order, as finite numbers
 * (Requirements 8.6, 8.7).
 */
function expectPolylineMatchesPoints(plot: ChartPlot): void {
  if (plot.points.length < MINIMUM_LINE_POINTS) {
    expect(plot.polyline).toBeNull();

    return;
  }

  expect(typeof plot.polyline).toBe('string');

  // Narrowed by the assertion above; read through a local so the parse below is
  // typed without a non-null assertion.
  const polyline = plot.polyline ?? '';
  const pairs = readPolyline(polyline);

  expect(pairs).toHaveLength(plot.points.length);

  for (const [index, pair] of pairs.entries()) {
    // Two coordinates per point, comma-separated.
    expect(pair).toHaveLength(2);

    const [x, y] = pair;

    expect(Number.isFinite(x)).toBe(true);
    expect(Number.isFinite(y)).toBe(true);

    // The attribute is rounded for readability, so it may differ from the
    // coordinate only by that rounding.
    expectNear(x, plot.points[index].x, PRINT_TOLERANCE);
    expectNear(y, plot.points[index].y, PRINT_TOLERANCE);
  }
}

/** Whether widening a flat domain around `rating` can separate its bounds. */
function widensRepresentably(rating: number): boolean {
  return rating - FLAT_DOMAIN_MARGIN < rating + FLAT_DOMAIN_MARGIN;
}

/* -------------------------------------------------------------------------- */
/* Generators: points                                                         */
/* -------------------------------------------------------------------------- */

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
  { weight: 2, arbitrary: fc.integer({ min: -1_000, max: 1_000 }) },
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
  { weight: 3, arbitrary: fc.double({ noNaN: true, noDefaultInfinity: true }) },
);

/** A rating at or below zero: the all-zero and all-negative flat histories. */
const nonPositiveRatingArb: fc.Arbitrary<number> = fc.oneof(
  { weight: 2, arbitrary: fc.constantFrom(0, -0) },
  { weight: 4, arbitrary: fc.integer({ min: -2_000, max: 0 }) },
  {
    weight: 2,
    arbitrary: fc.constantFrom(
      -1,
      -0.5,
      -1_000.5,
      -Number.EPSILON,
      -Number.MIN_VALUE,
      -Number.MAX_VALUE,
      Number.MIN_SAFE_INTEGER,
    ),
  },
  { weight: 2, arbitrary: fc.double({ min: -3_000, max: 0, noNaN: true }) },
);

/** One plottable point, as the parser would have produced it. */
const pointArb: fc.Arbitrary<ProgressionPoint> = fc.record({
  completedAtMs: instantArb,
  displayRating: ratingArb,
});

/* -------------------------------------------------------------------------- */
/* Generators: extents                                                        */
/* -------------------------------------------------------------------------- */

/** A positive length on one axis, in `viewBox` units. */
const lengthArb: fc.Arbitrary<number> = fc.oneof(
  { weight: 5, arbitrary: fc.integer({ min: 40, max: 800 }) },
  { weight: 2, arbitrary: fc.double({ min: 0.001, max: 800, noNaN: true }) },
  { weight: 1, arbitrary: fc.constantFrom(0.5, 1, 2, 320, 640, 1_000) },
);

/** The extents a component would plausibly declare as its `viewBox`. */
const PLAUSIBLE_EXTENTS: readonly ChartExtent[] = [
  { width: 640, height: 240, padding: 24 },
  { width: 320, height: 160, padding: 8 },
  { width: 1_000, height: 400, padding: 0 },
  { width: 480, height: 120, padding: 12 },
];

const plausibleExtentArb: fc.Arbitrary<ChartExtent> = fc.constantFrom(
  ...PLAUSIBLE_EXTENTS,
);

/** An extent with room to spare: padding well under half of either axis. */
const roomyExtentArb: fc.Arbitrary<ChartExtent> = fc
  .tuple(lengthArb, lengthArb, fc.double({ min: 0, max: 0.49, noNaN: true }))
  .map(([width, height, fraction]) => ({
    width,
    height,
    padding: Math.min(width, height) * fraction,
  }));

/**
 * An extent collapsed on **both** axes: padding at least half the longer side,
 * so neither drawing band has any room and both reduce to a centre line.
 */
const bothCollapsedExtentArb: fc.Arbitrary<ChartExtent> = fc
  .tuple(lengthArb, lengthArb, fc.double({ min: 0.5, max: 3, noNaN: true }))
  .map(([width, height, factor]) => ({
    width,
    height,
    padding: Math.max(width, height) * factor,
  }));

/**
 * An extent collapsed on exactly **one** axis, which is the asymmetric case a
 * both-or-neither generator never produces: one side no longer than twice the
 * padding, the other comfortably longer.
 */
const oneAxisCollapsedExtentArb: fc.Arbitrary<ChartExtent> = fc
  .tuple(
    fc.double({ min: 1, max: 100, noNaN: true }),
    fc.double({ min: 0.01, max: 2, noNaN: true }),
    fc.double({ min: 2.01, max: 8, noNaN: true }),
    fc.boolean(),
  )
  .map(([padding, tight, roomy, widthCollapses]) => ({
    width: padding * (widthCollapses ? tight : roomy),
    height: padding * (widthCollapses ? roomy : tight),
    padding,
  }));

/** Any extent within the contract: positive sides, non-negative padding. */
const anyExtentArb: fc.Arbitrary<ChartExtent> = fc.oneof(
  { weight: 3, arbitrary: plausibleExtentArb },
  { weight: 4, arbitrary: roomyExtentArb },
  { weight: 3, arbitrary: bothCollapsedExtentArb },
  { weight: 3, arbitrary: oneAxisCollapsedExtentArb },
);

/** Only the extents whose padding has collapsed the drawing box. */
const collapsedExtentArb: fc.Arbitrary<ChartExtent> = fc.oneof(
  { weight: 1, arbitrary: bothCollapsedExtentArb },
  { weight: 1, arbitrary: oneAxisCollapsedExtentArb },
);

/* -------------------------------------------------------------------------- */
/* Generators: degenerate series                                              */
/* -------------------------------------------------------------------------- */

/** How many points the multi-point degenerate families carry. */
const MIN_FLAT_POINTS = 2;
const MAX_FLAT_POINTS = 24;

/** A series whose points all completed in the very same millisecond. */
interface SimultaneousSeries {
  readonly instant: number;
  readonly series: readonly ProgressionPoint[];
}

/** A series whose points all carry the very same Display_Rating. */
interface FlatSeries {
  readonly rating: number;
  readonly series: readonly ProgressionPoint[];
}

const simultaneousSeriesArb: fc.Arbitrary<SimultaneousSeries> = fc
  .tuple(
    instantArb,
    fc.array(ratingArb, {
      minLength: MIN_FLAT_POINTS,
      maxLength: MAX_FLAT_POINTS,
    }),
  )
  .map(([instant, ratings]) => ({
    instant,
    series: ratings.map((displayRating) => ({
      completedAtMs: instant,
      displayRating,
    })),
  }));

/** A flat series from a given pool of ratings, its instants in series order. */
function flatSeriesArbFrom(
  ratings: fc.Arbitrary<number>,
): fc.Arbitrary<FlatSeries> {
  return fc
    .tuple(
      ratings,
      fc.array(instantArb, {
        minLength: MIN_FLAT_POINTS,
        maxLength: MAX_FLAT_POINTS,
      }),
    )
    .map(([rating, instants]) => ({
      rating,
      series: [...instants]
        .sort((left, right) => left - right)
        .map((completedAtMs) => ({ completedAtMs, displayRating: rating })),
    }));
}

const flatSeriesArb: fc.Arbitrary<FlatSeries> = flatSeriesArbFrom(ratingArb);

const nonPositiveFlatSeriesArb: fc.Arbitrary<FlatSeries> =
  flatSeriesArbFrom(nonPositiveRatingArb);

/** A series both flat and simultaneous: every point identical in both fields. */
const stackedSeriesArb: fc.Arbitrary<FlatSeries> = fc
  .tuple(
    instantArb,
    ratingArb,
    fc.integer({ min: MIN_FLAT_POINTS, max: MAX_FLAT_POINTS }),
  )
  .map(([completedAtMs, rating, count]) => ({
    rating,
    series: Array.from({ length: count }, () => ({
      completedAtMs,
      displayRating: rating,
    })),
  }));

/** Every degenerate family at once, for the claims they all share. */
const anyDegenerateSeriesArb: fc.Arbitrary<readonly ProgressionPoint[]> =
  fc.oneof(
    { weight: 1, arbitrary: fc.constant<readonly ProgressionPoint[]>([]) },
    {
      weight: 2,
      arbitrary: pointArb.map((point): readonly ProgressionPoint[] => [point]),
    },
    {
      weight: 3,
      arbitrary: simultaneousSeriesArb.map(
        ({ series }): readonly ProgressionPoint[] => series,
      ),
    },
    {
      weight: 3,
      arbitrary: flatSeriesArb.map(
        ({ series }): readonly ProgressionPoint[] => series,
      ),
    },
    {
      weight: 2,
      arbitrary: nonPositiveFlatSeriesArb.map(
        ({ series }): readonly ProgressionPoint[] => series,
      ),
    },
    {
      weight: 2,
      arbitrary: stackedSeriesArb.map(
        ({ series }): readonly ProgressionPoint[] => series,
      ),
    },
  );

/* -------------------------------------------------------------------------- */
/* The empty series                                                           */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 22: Every degenerate series plots without failing
// — the empty series plots nothing and yields no line
// Validates: Requirements 8.6
describe('plotting an empty progression series', () => {
  it('yields no points and no line, on any extent', () => {
    fc.assert(
      fc.property(anyExtentArb, (extent) => {
        const plot = plotProgression([], extent);

        expect(plot.points).toEqual([]);
        // No line string for the component to draw: it renders the no-history
        // statement and no axes instead (Requirement 8.6).
        expect(plot.polyline).toBeNull();

        expectWellFormedPlot(plot, [], extent);
      }),
      { numRuns: 300 },
    );
  });

  it('reports a finite, positive-height rating domain even though nothing is drawn', () => {
    fc.assert(
      fc.property(anyExtentArb, (extent) => {
        const plot = plotProgression([], extent);

        // Finite and ordered in every case, so no reader has to narrow a
        // nullable domain for a chart that is never drawn.
        expect(Number.isFinite(plot.ratingFloor)).toBe(true);
        expect(Number.isFinite(plot.ratingCeiling)).toBe(true);
        expect(plot.ratingCeiling).toBeGreaterThan(plot.ratingFloor);
      }),
      { numRuns: 200 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* The single-point series                                                    */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 22: Every degenerate series plots without failing
// — one reading is plotted as a point and never as a trend
// Validates: Requirements 8.7
describe('plotting a single-point progression series', () => {
  it('yields that one point and no line', () => {
    fc.assert(
      fc.property(pointArb, anyExtentArb, (point, extent) => {
        const plot = plotProgression([point], extent);

        expect(plot.points).toHaveLength(1);
        expect(plot.points[0].point).toBe(point);
        // Requirement 8.7 held at the geometry: there is no line string, so a
        // single reading cannot be drawn as a trend by accident.
        expect(plot.polyline).toBeNull();

        expectWellFormedPlot(plot, [point], extent);
      }),
      { numRuns: 400 },
    );
  });

  it('places that point at the centre of the drawing box', () => {
    fc.assert(
      fc.property(pointArb, anyExtentArb, (point, extent) => {
        const { horizontal, vertical } = bandsOf(extent);
        const plotted = plotProgression([point], extent).points[0];

        // One reading spans no time and is as flat as a hundred equal ones, so
        // both domains resolve to their centre.
        expectNear(plotted.x, centreOf(horizontal), centreTolerance(horizontal));
        expectNear(plotted.y, centreOf(vertical), centreTolerance(vertical));
      }),
      { numRuns: 300 },
    );
  });

  it('reports a rating domain that contains the point and has positive height', () => {
    fc.assert(
      fc.property(pointArb, anyExtentArb, (point, extent) => {
        const plot = plotProgression([point], extent);

        expect(plot.ratingFloor).toBeLessThanOrEqual(point.displayRating);
        expect(plot.ratingCeiling).toBeGreaterThanOrEqual(point.displayRating);

        if (widensRepresentably(point.displayRating)) {
          // Widened rather than scaled from a zero-height domain.
          expect(plot.ratingCeiling).toBeGreaterThan(plot.ratingFloor);
        }
      }),
      { numRuns: 300 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Every instant equal: a zero-width time domain                              */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 22: Every degenerate series plots without failing
// — a series completed in one millisecond has no time domain to divide by
// Validates: Requirements 8.8
describe('plotting a series whose completion instants are all equal', () => {
  it('places every point at the horizontal centre, with finite coordinates', () => {
    fc.assert(
      fc.property(
        simultaneousSeriesArb,
        anyExtentArb,
        ({ series }, extent) => {
          const plot = plotProgression(series, extent);
          const { horizontal } = bandsOf(extent);
          const tolerance = centreTolerance(horizontal);

          expectWellFormedPlot(plot, series, extent);

          for (const plotted of plot.points) {
            // A zero-width domain resolves to the centre rather than to NaN.
            expectNear(plotted.x, centreOf(horizontal), tolerance);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it('still draws a line, because there are two or more points', () => {
    fc.assert(
      fc.property(simultaneousSeriesArb, anyExtentArb, ({ series }, extent) => {
        const plot = plotProgression(series, extent);

        // Only the empty and single-point cases suppress the line; a vertical
        // stack of readings is still a series of two or more.
        expect(typeof plot.polyline).toBe('string');
        expect(plot.polyline).not.toBe('');
      }),
      { numRuns: 200 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Every rating equal: a zero-height rating domain                            */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 22: Every degenerate series plots without failing
// — a flat history renders as a flat line rather than failing
// Validates: Requirements 8.8
describe('plotting a series whose display ratings are all equal', () => {
  it('scales from a widened domain, never a zero-height one', () => {
    fc.assert(
      fc.property(flatSeriesArb, anyExtentArb, ({ rating, series }, extent) => {
        const plot = plotProgression(series, extent);

        expectWellFormedPlot(plot, series, extent);

        expect(plot.ratingFloor).toBeLessThanOrEqual(rating);
        expect(plot.ratingCeiling).toBeGreaterThanOrEqual(rating);

        if (widensRepresentably(rating)) {
          // The division's divisor is the domain's height, so this is the claim
          // that it was never zero (Requirement 8.8).
          expect(plot.ratingCeiling).toBeGreaterThan(plot.ratingFloor);
        } else {
          // Too large for half a unit to register: the domain stays flat and the
          // centre-line rule below takes over, still without a NaN.
          expect(plot.ratingCeiling).toBe(plot.ratingFloor);
        }
      }),
      { numRuns: 400 },
    );
  });

  it('draws the flat line along the vertical centre', () => {
    fc.assert(
      fc.property(flatSeriesArb, anyExtentArb, ({ series }, extent) => {
        const plot = plotProgression(series, extent);
        const { vertical } = bandsOf(extent);
        const tolerance = centreTolerance(vertical);

        for (const plotted of plot.points) {
          // Symmetric widening is what puts a history that never moved on the
          // centre line rather than pinned against an axis.
          expectNear(plotted.y, centreOf(vertical), tolerance);
        }

        // And flat means flat: one vertical coordinate for the whole series.
        const verticals = new Set(plot.points.map((plotted) => plotted.y));

        expect(verticals.size).toBe(1);
      }),
      { numRuns: 400 },
    );
  });

  it('does the same for an all-zero and an all-negative history', () => {
    fc.assert(
      fc.property(
        nonPositiveFlatSeriesArb,
        anyExtentArb,
        ({ rating, series }, extent) => {
          const plot = plotProgression(series, extent);
          const { vertical } = bandsOf(extent);

          expectWellFormedPlot(plot, series, extent);

          // A rating of zero is not an absent rating, and a negative one is not
          // an error: both are flat histories and plot like any other.
          expect(plot.ratingFloor).toBeLessThanOrEqual(rating);
          expect(plot.ratingCeiling).toBeGreaterThanOrEqual(rating);

          for (const plotted of plot.points) {
            expectNear(plotted.y, centreOf(vertical), centreTolerance(vertical));
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Flat and simultaneous at once                                              */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 22: Every degenerate series plots without failing
// — both domains flat at once
// Validates: Requirements 8.7, 8.8
describe('plotting a series that is both flat and simultaneous', () => {
  it('stacks every point on the centre of the drawing box', () => {
    fc.assert(
      fc.property(stackedSeriesArb, anyExtentArb, ({ series }, extent) => {
        const plot = plotProgression(series, extent);
        const { horizontal, vertical } = bandsOf(extent);

        expectWellFormedPlot(plot, series, extent);

        for (const plotted of plot.points) {
          expectNear(plotted.x, centreOf(horizontal), centreTolerance(horizontal));
          expectNear(plotted.y, centreOf(vertical), centreTolerance(vertical));
        }
      }),
      { numRuns: 300 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Extents collapsed by their padding                                         */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 22: Every degenerate series plots without failing
// — a drawing box with no room left still yields finite coordinates
// Validates: Requirements 8.8
describe('plotting onto an extent collapsed by its padding', () => {
  it('keeps every coordinate finite and on the collapsed axis', () => {
    fc.assert(
      fc.property(
        anyDegenerateSeriesArb,
        collapsedExtentArb,
        (series, extent) => {
          const plot = plotProgression(series, extent);
          const { horizontal, vertical } = bandsOf(extent);

          expectWellFormedPlot(plot, series, extent);

          for (const plotted of plot.points) {
            if (horizontal.low === horizontal.high) {
              // No room between the insets: the box is its own centre line, and
              // the coordinate sits on it rather than outside an inverted band.
              expect(plotted.x).toBe(horizontal.low);
            }

            if (vertical.low === vertical.high) {
              expect(plotted.y).toBe(vertical.low);
            }
          }
        },
      ),
      { numRuns: 400 },
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Every family, every shared claim                                           */
/* -------------------------------------------------------------------------- */

// Feature: web-player-stats-screen, Property 22: Every degenerate series plots without failing
// — no degenerate series raises, and the line is present for exactly two points or more
// Validates: Requirements 8.6, 8.7, 8.8
describe('plotting any degenerate series', () => {
  it('raises nothing and yields only finite coordinates', () => {
    fc.assert(
      fc.property(anyDegenerateSeriesArb, anyExtentArb, (series, extent) => {
        expect(() => plotProgression(series, extent)).not.toThrow();

        expectWellFormedPlot(plotProgression(series, extent), series, extent);
      }),
      { numRuns: 500 },
    );
  });

  it('yields a line for exactly the series of two or more points', () => {
    fc.assert(
      fc.property(anyDegenerateSeriesArb, anyExtentArb, (series, extent) => {
        const plot = plotProgression(series, extent);

        // One biconditional, so neither a missing line nor a spurious one can
        // pass (Requirements 8.6, 8.7).
        expect(plot.polyline !== null).toBe(
          series.length >= MINIMUM_LINE_POINTS,
        );
      }),
      { numRuns: 500 },
    );
  });

  it('yields the same plot on a repeated call', () => {
    fc.assert(
      fc.property(anyDegenerateSeriesArb, anyExtentArb, (series, extent) => {
        const first = plotProgression(series, extent);
        const second = plotProgression(series, extent);

        // Pure: the degenerate rules are part of the mapping, not a one-off
        // repair applied to whichever call happened first (Requirement 8.9).
        expect(second.polyline).toBe(first.polyline);
        expect(second.ratingFloor).toBe(first.ratingFloor);
        expect(second.ratingCeiling).toBe(first.ratingCeiling);
        expect(second.points.map((plotted) => [plotted.x, plotted.y])).toEqual(
          first.points.map((plotted) => [plotted.x, plotted.y]),
        );
      }),
      { numRuns: 200 },
    );
  });
});
