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
 * slope. The two hues from the token table reinforce those cues and carry
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
import { type ReactElement } from 'react';

import { plotProgression, type ChartExtent } from '../lib/chartGeometry';
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

/** The `viewBox` the drawing is laid out in. */
const VIEW_BOX = `0 0 ${String(PROGRESSION_CHART_WIDTH)} ${String(PROGRESSION_CHART_HEIGHT)}`;

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

  return (
    <svg
      className="player-stats-progression-chart"
      viewBox={VIEW_BOX}
      preserveAspectRatio="none"
      // 8.5: the Progression_Table is the accessible representation, so this
      // drawing is hidden rather than described — the figures are announced
      // once, by the table.
      aria-hidden="true"
      // Hidden *and* unfocusable: a focusable element in an `aria-hidden`
      // subtree is a defect, and some engines focus an `svg` by default.
      focusable="false"
      data-player-stats-progression-chart="true"
    >
      {/* The bounds of the rating domain the line was scaled against. A frame
          for the data, drawn only because there is data — never on its own
          (Requirement 8.6). */}
      <line
        className="player-stats-progression-chart__grid"
        x1={PROGRESSION_CHART_PADDING}
        y1={gridTop}
        x2={PROGRESSION_CHART_WIDTH - PROGRESSION_CHART_PADDING}
        y2={gridTop}
      />
      <line
        className="player-stats-progression-chart__grid"
        x1={PROGRESSION_CHART_PADDING}
        y1={gridBottom}
        x2={PROGRESSION_CHART_WIDTH - PROGRESSION_CHART_PADDING}
        y2={gridBottom}
      />

      {/* 8.7: `polyline` is null for the one-point series, so a single reading
          cannot be drawn as a trend. */}
      {plot.polyline === null ? null : (
        <polyline
          className="player-stats-progression-chart__line"
          points={plot.polyline}
          data-player-stats-progression-line="true"
        />
      )}

      {/* 15.6: a mark is a shape at a position. Both carry the reading without
          reference to the hue. */}
      {plot.points.map((plotted, index) => (
        <circle
          key={`${String(plotted.point.completedAtMs)}:${String(plotted.point.displayRating)}:${String(index)}`}
          className="player-stats-progression-chart__point"
          cx={plotted.x}
          cy={plotted.y}
          r={POINT_MARK_RADIUS}
          data-player-stats-progression-point={index}
        />
      ))}
    </svg>
  );
}

export default ProgressionChart;
