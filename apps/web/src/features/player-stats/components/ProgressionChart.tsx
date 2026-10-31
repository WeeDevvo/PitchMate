/**
 * The Progression_Chart: the Progression_Series drawn as a line over time.
 *
 * It is the *illustration* of the progression section and not its content. The
 * content is the Progression_Table rendered beside it, which carries every
 * plotted figure in text (Requirement 8.4). This component therefore holds no
 * copy, formats no figure, and renders no text node at all — it reads
 * {@link plotProgression} and writes attributes.
 *
 * ### Scalable vector graphics, with a fixed `viewBox`
 *
 * The drawing is an `svg` and nothing else: no raster drawing surface, no
 * drawing context, no measured DOM box (Requirement 8.2). The extent is the
 * three constants below, expressed in `viewBox` units, so:
 *
 *  - the geometry is a function of the **data** alone, and the same series draws
 *    the same picture in a browser, in CI, and in jsdom — which computes no
 *    layout and would report every measured box as zero;
 *  - the stylesheet gives the `svg` a fluid width and the `viewBox` scales the
 *    one drawing to any container, so the chart introduces no fixed width and no
 *    horizontal overflow (Requirement 15.7).
 *
 * Nothing here measures anything, and there is no resize observer, no layout
 * read, and no effect — the component is a pure function of its props.
 *
 * ### Hidden from assistive technology, deliberately
 *
 * Requirement 8.5 allows two treatments, and this is the second: the `svg`
 * carries `aria-hidden="true"` and `focusable="false"`, and the
 * Progression_Table is the accessible representation. The figures are therefore
 * announced **exactly once**, by a real table with real headers, rather than
 * once by a chart description and again by the table. `focusable="false"` is the
 * other half of that: a focusable element inside an `aria-hidden` subtree is an
 * accessibility defect in its own right, and legacy engines make an `svg`
 * focusable by default.
 *
 * Because the chart is hidden, it may carry no information the table does not.
 * It renders no text, no tick label, and no tooltip, so there is nothing here
 * that is visible-only.
 *
 * ### Meaning by position and shape, not by colour
 *
 * Each value is carried twice without reference to its hue (Requirements 15.6,
 * 16.6): a point's **position** in the drawing box states when the match
 * completed and what the rating was, and a circular **mark** states that a
 * reading exists at that position — a mark is a shape, visible in greyscale,
 * under a forced-colours mode, and to a reader who perceives no colour at all.
 * The stroked line between the marks states the direction of travel by its
 * slope. A provisional reading's mark is a **dashed** ring and the line
 * through it is dashed, so it stays distinct from a settled one without its
 * amber, and the table states it as the "~" band in words. The two hues from the token table reinforce those cues and carry
 * nothing on their own, and every figure is also stated in words by the table.
 *
 * ### The two degenerate series are handled here as the geometry handles them
 *
 *  - **An empty series renders nothing at all** — no chart and no empty set of
 *    axes (Requirement 8.6). An axis frame around no data reads as a flat
 *    history rather than as an absent one, so the component renders `null` and
 *    the Progression_Table states {@link NO_RATING_HISTORY} in place of its
 *    table.
 *  - **A single point renders no line segment** (Requirement 8.7), because one
 *    reading is not a trend. That is not a condition tested here: `ChartPlot`
 *    carries `polyline === null` for exactly the empty and one-point series, so
 *    there is no line string available to render by accident.
 *
 * Requirements: 8.2, 8.5, 8.6, 8.7, 15.6
 */
import { type ReactElement, type SVGProps } from 'react';
import { RatingChart } from '../../../ui';

import {
  areaUnderLine,
  plotProgression,
  provisionalBands,
  provisionalLines,
  ratingTicks,
  type ChartExtent,
  type PlottedPoint,
} from '../lib/chartGeometry';
import { formatInstantMonth } from '../lib/instantFormat';
import { PROVISIONAL_BAND_LABEL } from '../lib/messages';
import { formatCount } from '../lib/numberFormat';
import type { ProgressionPoint } from '../lib/parse/playerProfile';
import '../styles/playerStatsTokens.css';
import './ProgressionChart.css';

/** The selector of the chart, so a test can assert over its whole subtree. */
export const PROGRESSION_CHART_SELECTOR =
  '[data-player-stats-progression-chart="true"]';

/** The selector of the plotted line, which exists only for two points or more. */
export const PROGRESSION_LINE_SELECTOR =
  '[data-player-stats-progression-line="true"]';

/** The selector of one point mark, so a test can read the marks in order. */
export const PROGRESSION_POINT_SELECTOR =
  '[data-player-stats-progression-point]';

/**
 * The chart's width in `viewBox` units.
 *
 * A constant, not a measurement — see the module note. The figure is a
 * coordinate space rather than a size in pixels: the stylesheet sets the
 * rendered width to 100% of the section, and this ratio is what the drawing is
 * laid out in. Roughly 16:5 gives a progression enough horizontal room to read
 * as a trend without becoming a tall block on a narrow viewport.
 */
export const PROGRESSION_CHART_WIDTH = 640;

/** The chart's height in `viewBox` units. See {@link PROGRESSION_CHART_WIDTH}. */
export const PROGRESSION_CHART_HEIGHT = 200;

/**
 * The inset on all four sides, in `viewBox` units.
 *
 * It leaves room for a point mark at the extremes of the data to be drawn whole
 * rather than clipped in half by the edge of the `svg`: the first and last
 * points sit on the drawing box's own bounds, and the mark is drawn around them.
 */
export const PROGRESSION_CHART_PADDING = 12;

/** The radius of one point mark, in `viewBox` units. */
const POINT_MARK_RADIUS = 4;

/**
 * The drawing surface, assembled once at module scope.
 *
 * Built here rather than inside the component so it is the same object on every
 * render and visibly a constant rather than something derived from a prop.
 */
const CHART_EXTENT: ChartExtent = {
  width: PROGRESSION_CHART_WIDTH,
  height: PROGRESSION_CHART_HEIGHT,
  padding: PROGRESSION_CHART_PADDING,
};

/** Test hooks on the line and on each mark, read by the chart's own tests. */
const LINE_HOOK = { 'data-player-stats-progression-line': 'true' } as SVGProps<SVGPolylineElement>;

function pointHook(index: number): SVGProps<SVGCircleElement> {
  return { 'data-player-stats-progression-point': index } as SVGProps<SVGCircleElement>;
}

/** A month label at the first reading of each month, left to right. */
function monthTicks(points: readonly PlottedPoint[]): { at: number; label: string }[] {
  const ticks: { at: number; label: string }[] = [];
  for (const plotted of points) {
    const label = formatInstantMonth(plotted.point.completedAtMs);
    if (label !== '' && ticks[ticks.length - 1]?.label !== label) ticks.push({ at: plotted.x, label });
  }
  return ticks;
}

export interface ProgressionChartProps {
  /**
   * The Progression_Series, in `toProgressionSeries` order (Requirement 8.1).
   *
   * Plotted as given: this component neither sorts nor filters, so the picture
   * is of the series the caller actually passed.
   */
  readonly series: readonly ProgressionPoint[];
}

/**
 * Render the Progression_Chart, or nothing where there is no history to draw.
 *
 * @returns the `svg`, or `null` for an empty series (Requirement 8.6)
 *
 * Requirements: 8.2, 8.5, 8.6, 8.7, 15.6
 */
export function ProgressionChart({
  series,
}: ProgressionChartProps): ReactElement | null {
  // 8.6: no chart, and no axis frame either. The Progression_Table states the
  // absence in words.
  if (series.length === 0) {
    return null;
  }

  const plot = plotProgression(series, CHART_EXTENT);

  // The drawing box's own bounds, which the two grid rules sit on. Taken from
  // the extent rather than from a plotted coordinate, so they frame the box even
  // where every reading is the same and the line runs through its centre.
  const gridTop = PROGRESSION_CHART_PADDING;
  const gridBottom = PROGRESSION_CHART_HEIGHT - PROGRESSION_CHART_PADDING;
  const gridX1 = PROGRESSION_CHART_PADDING;
  const gridX2 = PROGRESSION_CHART_WIDTH - PROGRESSION_CHART_PADDING;

  // Round ratings up the side, each with a rule across the plot, placed on the
  // same scale the line was drawn against.
  const ticks = ratingTicks(plot.ratingFloor, plot.ratingCeiling, gridTop, gridBottom);

  return (
    <RatingChart
      className="player-stats-progression-chart"
      width={PROGRESSION_CHART_WIDTH}
      height={PROGRESSION_CHART_HEIGHT}
      data-player-stats-progression-chart="true"
      // The bounds of the rating domain the line was scaled against. A frame for
      // the data, drawn only because there is data — never on its own
      // (Requirement 8.6).
      gridLines={[
        // The baseline, then a rule at each tick that isn't on it.
        { x1: gridX1, x2: gridX2, y: gridBottom },
        ...ticks
          .filter((tick) => tick.y !== gridBottom)
          .map((tick) => ({ x1: gridX1, x2: gridX2, y: tick.y })),
      ]}
      yTicks={ticks.map((tick) => ({ at: tick.y, label: formatCount(tick.rating) }))}
      xTicks={monthTicks(plot.points)}
      area={areaUnderLine(plot.points, gridBottom)}
      // The band behind provisional readings, labelled once, as the design
      // system draws a player's first matches.
      provisionalBands={provisionalBands(plot.points)}
      provisionalLabel={PROVISIONAL_BAND_LABEL}
      // 8.7: `polyline` is null for the one-point series, so a single reading
      // cannot be drawn as a trend.
      polyline={plot.polyline}
      lineProps={LINE_HOOK}
      // The stretches through provisional readings, drawn dashed.
      provisionalLines={provisionalLines(plot.points)}
      // 15.6: a mark is a shape at a position. Both carry the reading without
      // reference to the hue.
      marks={plot.points.map((plotted, index) => ({
        key: `${String(plotted.point.completedAtMs)}:${String(plotted.point.displayRating)}:${String(index)}`,
        x: plotted.x,
        y: plotted.y,
        provisional: plotted.point.provisional,
      }))}
      pointRadius={POINT_MARK_RADIUS}
      pointProps={pointHook}
    />
  );
}

export default ProgressionChart;
