/**
 * The Chart_Geometry: the pure mapping from a Progression_Series and a drawing
 * extent to plotted coordinates (Requirement 8.3).
 *
 * Requirement 8.3 asks for **every** plotted coordinate to come from one pure
 * function that is total over every Progression_Series and every positive
 * drawing extent and that never yields a non-finite coordinate. This module is
 * that function. The component that draws the chart owns markup and nothing
 * else: it reads {@link ChartPlot} and writes attributes.
 *
 * ## The extent is a constant, never a measurement
 *
 * {@link ChartExtent} is expressed in `viewBox` units and supplied by the
 * component as a constant. It is deliberately **not** a measured DOM size:
 * jsdom computes no layout, so a geometry fed by `getBoundingClientRect` would
 * be untestable and would couple the drawing to a browser's box model. A fixed
 * `viewBox` with a fluid CSS width scales the same drawing to any container and
 * leaves the geometry a function of the data alone (Requirements 8.3, 15.7).
 *
 * ## The degenerate cases are the substance
 *
 * A rating history is short, flat, or absent far more often than it is a tidy
 * upward curve, and every one of those shapes divides by a zero-width or
 * zero-height domain if the mapping is written for the happy path and patched
 * afterwards. They are therefore resolved up front, each as a stated rule:
 *
 * | Case | Treatment |
 * | --- | --- |
 * | empty series | no points, and `polyline` is `null` — the component renders the no-history statement and no axes (Requirement 8.6) |
 * | one point | one point at the horizontal centre, and `polyline` is `null`, so a single reading is never drawn as a trend (Requirement 8.7) |
 * | all instants equal | the time domain has no width; every point sits at the horizontal centre |
 * | all ratings equal | the rating domain is widened symmetrically by {@link FLAT_DOMAIN_MARGIN}, so `y` is finite and the flat line sits at the vertical centre (Requirement 8.8) |
 * | extent narrower or shorter than twice its padding | the drawing box collapses to its centre line; coordinates stay finite and inside the box |
 *
 * Note which direction the flat-history rule goes. The alternative — scaling a
 * zero-height domain and then repairing the `NaN` — would put a non-finite
 * number in the function's own arithmetic and rely on a later guard catching it.
 * Widening the *domain* instead means the division never has a zero divisor, and
 * the "flat history renders as a flat line rather than failing" of Requirement
 * 8.8 is a consequence of the mapping rather than of a patch.
 *
 * ## Totality is structural
 *
 * Every fraction is resolved by {@link unitFraction}, which answers a number in
 * the closed unit range for *any* three arguments — including a domain of zero
 * width, a domain so wide its span overflows to infinity, and values no parsed
 * profile can hold. Every coordinate is then placed by {@link place} between two
 * bounds that {@link resolveBand} guarantees are finite. Non-finiteness
 * therefore has nowhere to enter, which is why Property 20 can assert it over
 * arbitrary series and extents rather than over a chosen few.
 *
 * React-free and DOM-free like every module under `lib/` (Requirement 14.3):
 * one imported **type**, no clock, no locale, no storage, no global, and nothing
 * raised for any input.
 *
 * Requirements: 8.3, 8.6, 8.7, 8.8
 */

import type { ProgressionPoint } from './parse/playerProfile';

/**
 * How far either side of a flat rating domain is widened, in Display_Rating
 * units (Requirement 8.8).
 *
 * A Display_Rating is a whole number, so half a unit each side gives a
 * one-unit band centred on the value — which puts the flat line on the vertical
 * centre line, where a history that never moved belongs. The figure's only real
 * job is to be positive and symmetric; the centring follows from the symmetry,
 * not from the size.
 */
const FLAT_DOMAIN_MARGIN = 0.5;

/**
 * The Display_Rating the reported domain is centred on when there is no series
 * to take one from.
 *
 * An empty series plots nothing, so this value colours no coordinate. It exists
 * only so {@link ChartPlot.ratingFloor} and {@link ChartPlot.ratingCeiling} are
 * finite and ordered in every case, rather than being nullable members every
 * reader has to narrow for a chart that is not drawn (Requirement 8.6).
 */
const EMPTY_DOMAIN_CENTRE = 0;

/** The fraction of a band its centre line sits at. */
const CENTRE_FRACTION = 0.5;

/** The low end of the closed fraction range coordinates are placed from. */
const DOMAIN_START = 0;

/** The high end of that range. */
const DOMAIN_END = 1;

/**
 * Decimal places kept in the `polyline` attribute.
 *
 * `viewBox` units are typically a few hundred across, so thousandths are far
 * finer than a device pixel can show. Rounding keeps the emitted attribute
 * readable in a snapshot or a DOM inspection without making it any less
 * deterministic — the rounding is a function of the coordinate, which is itself
 * a function of the data (Requirement 8.9).
 */
const COORDINATE_DECIMALS = 3;

/** Separates the two coordinates of one `polyline` point. */
const COORDINATE_SEPARATOR = ',';

/** Separates consecutive `polyline` points. */
const POINT_SEPARATOR = ' ';

/** The number of points below which there is no line segment to draw. */
const MINIMUM_LINE_POINTS = 2;

/** The divisor that takes a surface's length to its centre line. */
const HALVES = 2;

/**
 * The drawing surface the chart is laid out on, in `viewBox` units.
 *
 * A constant of the component rather than a measured size — see the module note.
 * The contract is a positive `width`, a positive `height`, and a non-negative
 * `padding`; the geometry is nonetheless total outside it, because a function
 * asked to be total over every extent is easier to trust than one documented to
 * be.
 */
export interface ChartExtent {
  /** The full width of the surface, padding included. */
  readonly width: number;
  /** The full height of the surface, padding included. */
  readonly height: number;
  /** The inset on all four sides, leaving the drawing box in the middle. */
  readonly padding: number;
}

/** One Progression_Point placed on the surface. */
export interface PlottedPoint {
  /** The horizontal coordinate, inside the drawing box and finite. */
  readonly x: number;
  /** The vertical coordinate, inside the drawing box and finite. */
  readonly y: number;
  /** The point these coordinates were derived from, carried through unchanged. */
  readonly point: ProgressionPoint;
}

/** Everything the Progression_Chart needs to draw one Progression_Series. */
export interface ChartPlot {
  /** The plotted points, in the series' order. */
  readonly points: readonly PlottedPoint[];
  /**
   * The points as an SVG `polyline` attribute value, or `null` where there is no
   * line to draw: the empty series and the single-point series (Requirements
   * 8.6, 8.7).
   */
  readonly polyline: string | null;
  /** The low end of the rating domain the vertical axis was scaled from. */
  readonly ratingFloor: number;
  /** The high end of it. Always greater than the floor where the span can be represented. */
  readonly ratingCeiling: number;
}

/** A closed, finite, non-decreasing interval on one axis of the surface. */
interface Band {
  /** The lesser bound. Finite. */
  readonly low: number;
  /** The greater bound, or the same value where the band has collapsed. Finite. */
  readonly high: number;
}

/** A closed interval of values being mapped onto a {@link Band}. */
interface Domain {
  /** The value placed at the low end. */
  readonly floor: number;
  /** The value placed at the high end. */
  readonly ceiling: number;
}

/**
 * The band one axis of the drawing box occupies, given the surface's length on
 * that axis and its padding.
 *
 * Both bounds are finite for every pair of arguments, which is what lets
 * {@link place} guarantee a finite coordinate. Where the padding leaves no room
 * — a surface narrower or shorter than twice its padding, the case Property 20
 * calls out — the band **collapses to the centre line** rather than inverting:
 * an inverted band would put coordinates outside the box while still satisfying
 * a naive "between the bounds" test, whereas a collapsed one keeps every
 * coordinate at a single, honest position.
 *
 * A length or padding that is not finite is outside the contract and cannot
 * reach here from a component constant; it collapses to the origin rather than
 * propagating an infinity, so the totality claim holds without the caller
 * having to establish anything.
 *
 * @param length the surface's full extent on this axis
 * @param padding the inset at each end
 * @returns the drawing band, both bounds finite, `low` never above `high`
 */
function resolveBand(length: number, padding: number): Band {
  const low = padding;
  const high = length - padding;

  if (Number.isFinite(low) && Number.isFinite(high) && high > low) {
    return { low, high };
  }

  // No room between the insets: the box is its own centre line.
  const collapsed = Number.isFinite(length) ? length / HALVES : 0;

  return { low: collapsed, high: collapsed };
}

/**
 * Where a value sits in a domain, as a fraction of the closed unit range.
 *
 * Total over every triple of arguments, which is the whole point of routing
 * every scaling through it:
 *
 * - a domain of zero width — all instants equal, all ratings equal and too large
 *   for {@link FLAT_DOMAIN_MARGIN} to separate — yields the centre, so the
 *   division never has a zero divisor;
 * - a domain whose span overflows to infinity yields the centre as well, rather
 *   than the `Infinity / Infinity` a direct division would produce;
 * - a fraction outside the unit range is clamped, so floating-point error near a
 *   bound cannot push a coordinate out of the drawing box.
 *
 * Clamping preserves order: the fraction is non-decreasing in `value` wherever
 * it varies at all, and constant where it does not, so the horizontal
 * coordinates of an instant-ordered series are non-decreasing (Property 21).
 *
 * @param value the value being placed
 * @param domain the interval it is placed within
 * @returns a finite number between 0 and 1 inclusive
 */
function unitFraction(value: number, domain: Domain): number {
  const span = domain.ceiling - domain.floor;

  if (!Number.isFinite(span) || span <= 0) {
    return CENTRE_FRACTION;
  }

  const fraction = (value - domain.floor) / span;

  if (!Number.isFinite(fraction)) {
    return CENTRE_FRACTION;
  }

  if (fraction < DOMAIN_START) {
    return DOMAIN_START;
  }

  if (fraction > DOMAIN_END) {
    return DOMAIN_END;
  }

  return fraction;
}

/**
 * The coordinate a unit fraction names within a band.
 *
 * Finite for every input, because {@link resolveBand} hands over finite bounds
 * and {@link unitFraction} a finite fraction; the explicit check is a guard on
 * that reasoning rather than a case the callers can reach. Clamped to the band
 * for the same reason the fraction is clamped to the unit range: Requirement
 * 8.3's "inside the drawing box" should not rest on the exactness of one
 * multiplication.
 *
 * @param fraction a number between 0 and 1 inclusive
 * @param band the interval to place it in
 * @returns a finite coordinate between the band's bounds inclusive
 */
function place(fraction: number, band: Band): number {
  const coordinate = band.low + fraction * (band.high - band.low);

  if (!Number.isFinite(coordinate)) {
    return band.low;
  }

  if (coordinate < band.low) {
    return band.low;
  }

  if (coordinate > band.high) {
    return band.high;
  }

  return coordinate;
}

/**
 * The time domain a series spans.
 *
 * Read as a plain fold rather than through `Math.min`/`Math.max` so that the
 * answer is derived by comparisons alone — a value that compares false against
 * everything would leave the fold's seed in place instead of poisoning the
 * result. An empty series yields a zero-width domain, which {@link unitFraction}
 * reads as the centre; so does a series whose instants are all equal, which is
 * exactly the intended treatment of both.
 *
 * @param series the Progression_Series, in order or not
 * @returns the interval its completion instants occupy
 */
function resolveTimeDomain(series: readonly ProgressionPoint[]): Domain {
  const first = series[0];

  if (first === undefined) {
    return { floor: EMPTY_DOMAIN_CENTRE, ceiling: EMPTY_DOMAIN_CENTRE };
  }

  let floor = first.completedAtMs;
  let ceiling = first.completedAtMs;

  for (const point of series) {
    if (point.completedAtMs < floor) {
      floor = point.completedAtMs;
    }

    if (point.completedAtMs > ceiling) {
      ceiling = point.completedAtMs;
    }
  }

  return { floor, ceiling };
}

/**
 * The rating domain a series is scaled against, widened where it would otherwise
 * have no height (Requirement 8.8).
 *
 * The widening is **symmetric**, by {@link FLAT_DOMAIN_MARGIN} at each end, and
 * that symmetry is what puts a flat history on the vertical centre line: the
 * single rating sits at the midpoint of its own widened band. A one-point series
 * is widened for the same reason — one reading is as flat as a hundred equal
 * ones — and an empty series reports a widened band around
 * {@link EMPTY_DOMAIN_CENTRE} so its floor and ceiling are finite and ordered
 * like every other case.
 *
 * Widening can fail to separate the bounds for a rating so large that adding
 * half a unit does not change it. No parsed Display_Rating is anywhere near
 * that, and nothing breaks if one were: {@link unitFraction} reads the still-flat
 * domain as the centre, which is where the flat line was going anyway.
 *
 * This is domain arithmetic for the vertical axis, not arithmetic *on* a
 * Display_Rating for presentation; the figures the screen shows are carried
 * through unchanged (Requirement 7.8).
 *
 * @param series the Progression_Series, in order or not
 * @returns the interval the vertical axis is scaled from
 */
function resolveRatingDomain(series: readonly ProgressionPoint[]): Domain {
  const first = series[0];

  if (first === undefined) {
    return widenFlatDomain(EMPTY_DOMAIN_CENTRE);
  }

  let floor = first.displayRating;
  let ceiling = first.displayRating;

  for (const point of series) {
    if (point.displayRating < floor) {
      floor = point.displayRating;
    }

    if (point.displayRating > ceiling) {
      ceiling = point.displayRating;
    }
  }

  if (ceiling > floor) {
    return { floor, ceiling };
  }

  // Every reading is the same: widen rather than scale a zero-height domain.
  return widenFlatDomain(floor);
}

/**
 * A one-value rating domain opened out symmetrically around that value.
 *
 * @param centre the Display_Rating every point of the series carries
 * @returns an interval centred on it
 */
function widenFlatDomain(centre: number): Domain {
  return {
    floor: centre - FLAT_DOMAIN_MARGIN,
    ceiling: centre + FLAT_DOMAIN_MARGIN,
  };
}

/**
 * One coordinate as it appears in the `polyline` attribute.
 *
 * Rounded to {@link COORDINATE_DECIMALS}, and normalised so a negative zero
 * prints as `0` — `-0` is a valid SVG number but a confusing thing to find in a
 * rendered attribute, and it compares equal to `0` anyway.
 *
 * @param value a finite coordinate
 * @returns its attribute text
 */
function printCoordinate(value: number): string {
  const rounded = Number(value.toFixed(COORDINATE_DECIMALS));

  return String(rounded === 0 ? 0 : rounded);
}

/**
 * The plot of one Progression_Series on one drawing extent (Requirement 8.3).
 *
 * Pure and total: the same plot for the same arguments, no clock, no DOM, no
 * global, and nothing raised for any series or any extent. Every coordinate it
 * yields is finite and lies within the drawing box — including where the box has
 * collapsed because the extent is narrower or shorter than twice its padding
 * (Property 20).
 *
 * The plotted points are in the order the series was handed over, one per point,
 * each carrying the point it came from; the series' own ordering is
 * `toProgressionSeries`' business (Requirement 8.1), and plotting neither
 * re-sorts nor filters it, so a caller that skipped that derivation gets a plot
 * of what it actually passed rather than a quietly different series. For an
 * instant-ordered series the horizontal coordinates are consequently
 * non-decreasing (Property 21).
 *
 * `polyline` is `null` for exactly the empty and single-point series. That is
 * Requirement 8.7 held at the geometry rather than in the markup: there is no
 * line string for a component to render by accident, so one reading cannot be
 * drawn as a trend. The empty case additionally yields no points at all, leaving
 * the component with nothing to draw and the no-history statement to render
 * instead (Requirement 8.6).
 *
 * @param series the Progression_Series to plot, normally in `toProgressionSeries` order
 * @param extent the surface to plot it on, in `viewBox` units
 * @returns the points, the line, and the rating domain the line was scaled from
 *
 * Requirements: 8.3, 8.6, 8.7, 8.8
 */
export function plotProgression(
  series: readonly ProgressionPoint[],
  extent: ChartExtent,
): ChartPlot {
  const horizontal = resolveBand(extent.width, extent.padding);
  const vertical = resolveBand(extent.height, extent.padding);

  const timeDomain = resolveTimeDomain(series);
  const ratingDomain = resolveRatingDomain(series);

  const points = series.map((point): PlottedPoint => {
    const x = place(unitFraction(point.completedAtMs, timeDomain), horizontal);

    // The vertical axis runs downwards in SVG, so a higher rating is a smaller
    // `y`: the fraction is taken from the top of the band.
    const y = place(
      DOMAIN_END - unitFraction(point.displayRating, ratingDomain),
      vertical,
    );

    return { x, y, point };
  });

  const polyline =
    points.length < MINIMUM_LINE_POINTS
      ? null
      : points
          .map(
            (plotted) =>
              `${printCoordinate(plotted.x)}${COORDINATE_SEPARATOR}${printCoordinate(plotted.y)}`,
          )
          .join(POINT_SEPARATOR);

  return {
    points,
    polyline,
    ratingFloor: ratingDomain.floor,
    ratingCeiling: ratingDomain.ceiling,
  };
}
