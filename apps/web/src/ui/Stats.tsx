import type { HTMLAttributes, ReactNode, SVGProps } from 'react';
import { Icon, type IconName } from './Icon';
import { cx } from './cx';
import './Stats.css';

/* ------------------------------------------------------------------ *
 * StatTile
 * ------------------------------------------------------------------ */

export interface StatTileProps extends HTMLAttributes<HTMLDivElement> {
  label: ReactNode;
  value: ReactNode;
  /** A line under the value: "Longest run", "No run recorded yet". */
  sub?: ReactNode;
  icon?: IconName;
  /** `accent` fills the tile green; `bib` tints it hi-vis for the bibs stat. */
  tone?: 'accent' | 'bib';
  /** The value is absent: muted, so a missing figure never reads as a zero. */
  empty?: boolean;
  /** Attributes for the label (`dt`) and the value (`dd`) elements. */
  labelProps?: HTMLAttributes<HTMLElement> & Record<`data-${string}`, string | undefined>;
  valueProps?: HTMLAttributes<HTMLElement> & Record<`data-${string}`, string | undefined>;
}

/**
 * One statistic as a tile. It renders a label (`dt`) and a value (`dd`), so put
 * tiles inside a `dl`; the grid around them is the caller's.
 */
export function StatTile({ label, value, sub, icon, tone, empty, labelProps, valueProps, className, ...rest }: StatTileProps) {
  return (
    <div {...rest} className={cx('pm-stat', tone && `pm-stat--${tone}`, empty && 'pm-stat--empty', className)}>
      <dt {...labelProps} className={cx('pm-stat__label', labelProps?.className)}>
        {icon && <Icon name={icon} size={16} />}
        {label}
      </dt>
      <dd {...valueProps} className={cx('pm-stat__value', valueProps?.className)}>
        <span className="pm-stat__figure pm-num">{value}</span>
        {sub !== undefined && <span className="pm-stat__sub">{sub}</span>}
      </dd>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * LeaderboardRow
 * ------------------------------------------------------------------ */

export interface LeaderboardRowProps extends HTMLAttributes<HTMLLIElement> {
  /** The position as printed: a tie shares one. */
  rank: ReactNode;
  /** First place gets the highlight disc. */
  first?: boolean;
  /** The viewer's own row is tinted. */
  me?: boolean;
  /** The player's name, usually the link to their stats, and any badges. */
  name: ReactNode;
  value: ReactNode;
  /** A small line under the value, such as the unit. */
  unit?: ReactNode;
  /** A line under the name, such as the player's record: "17W · 5D · 9L". */
  sub?: ReactNode;
}

/** One place in a leaderboard `ol`: position, player, value. */
export function LeaderboardRow({ rank, first, me, name, value, unit, sub, className, ...rest }: LeaderboardRowProps) {
  return (
    <li {...rest} className={cx('pm-lb', first && 'pm-lb--top1', me && 'pm-lb--me', className)}>
      <span className="pm-lb__rank pm-num">{rank}</span>
      {sub === undefined ? (
        <span className="pm-lb__who">{name}</span>
      ) : (
        <span className="pm-lb__main">
          <span className="pm-lb__who">{name}</span>
          <span className="pm-lb__sub">{sub}</span>
        </span>
      )}
      <span className="pm-lb__value pm-num">
        {value}
        {unit !== undefined && <small>{unit}</small>}
      </span>
    </li>
  );
}

/* ------------------------------------------------------------------ *
 * RatingChart
 * ------------------------------------------------------------------ */

export interface ChartPoint {
  key: string;
  x: number;
  y: number;
  /** A provisional reading: drawn as a dashed amber ring. */
  provisional?: boolean;
}

export interface RatingChartProps extends SVGProps<SVGSVGElement> {
  /** The plot's coordinate space. */
  width: number;
  height: number;
  /** Horizontal frame lines, in plot coordinates. */
  gridLines?: readonly { x1: number; x2: number; y: number }[];
  /** The line through the points as SVG `points`, or `null` for a single reading. */
  polyline: string | null;
  marks: readonly ChartPoint[];
  /** Stretches of the line through provisional readings, as SVG `points`, drawn dashed amber over it. */
  provisionalLines?: readonly string[];
  pointRadius?: number;
  /** Attributes for the line and for each point, such as test hooks. */
  lineProps?: SVGProps<SVGPolylineElement>;
  pointProps?: (index: number) => SVGProps<SVGCircleElement>;
  /** The area under the line as SVG `points`, shaded faintly. */
  area?: string | null;
  /** Horizontal spans of provisional readings, in plot coordinates: an amber band behind them. */
  provisionalBands?: readonly { x1: number; x2: number }[];
  /** The words on the first band, such as "~ Provisional". */
  provisionalLabel?: string;
  /** Rating labels up the side, at plot heights. */
  yTicks?: readonly ChartTick[];
  /** Labels along the bottom, such as months, at plot positions. */
  xTicks?: readonly ChartTick[];
}

/** An axis label at a position in plot coordinates (`y` for the side, `x` for the bottom). */
export interface ChartTick {
  at: number;
  label: string;
}

const percentOf = (value: number, whole: number) => `${(value / whole) * 100}%`;

/**
 * A rating line in the design system's chart style: frame lines, the line, and
 * a mark at each reading, the latest filled. Provisional readings get a dashed
 * amber ring, and the line through them is dashed amber. It draws a plot it is given; the geometry
 * (scaling, degenerate series) is the caller's. Decorative: show the readings as
 * text beside it, provisional ones as the "~" band.
 */
export function RatingChart({
  width,
  height,
  gridLines = [],
  polyline,
  marks,
  provisionalLines = [],
  pointRadius = 3.5,
  lineProps,
  pointProps,
  area,
  provisionalBands = [],
  provisionalLabel,
  yTicks = [],
  xTicks = [],
  className,
  ...rest
}: RatingChartProps) {
  const svg = (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
      {...rest}
      className={cx('pm-chart', className)}
    >
      {area ? <polygon className="pm-chart__area" points={area} /> : null}
      {provisionalBands.map((band) => (
        <rect
          key={`${band.x1}:${band.x2}`}
          className="pm-chart__band"
          x={band.x1}
          y={0}
          width={Math.max(0, band.x2 - band.x1)}
          height={height}
        />
      ))}
      {gridLines.map((line) => (
        <line key={line.y} className="pm-chart__grid" x1={line.x1} y1={line.y} x2={line.x2} y2={line.y} />
      ))}
      {polyline === null ? null : <polyline {...lineProps} className="pm-chart__line" points={polyline} />}
      {provisionalLines.map((points) => (
        <g key={points}>
          {/* Covers the solid line beneath, so the dashes read on the card. */}
          <polyline className="pm-chart__line pm-chart__line--prov-cover" points={points} />
          <polyline className="pm-chart__line pm-chart__line--prov" points={points} />
        </g>
      ))}
      {marks.map((point, index) => (
        <circle
          key={point.key}
          {...pointProps?.(index)}
          className={cx(
            'pm-chart__dot',
            index === marks.length - 1 && 'pm-chart__dot--last',
            point.provisional === true && 'pm-chart__dot--prov',
          )}
          cx={point.x}
          cy={point.y}
          r={index === marks.length - 1 ? pointRadius * 1.5 : pointRadius}
        />
      ))}
    </svg>
  );

  const firstBand = provisionalBands[0];
  if (yTicks.length === 0 && xTicks.length === 0 && (firstBand === undefined || !provisionalLabel)) return svg;

  // The labels are HTML laid over the drawing, so they keep their size however
  // the plot is stretched. Decorative like the plot: the readings are stated in
  // words beside the chart.
  return (
    <div className="pm-chart-frame" aria-hidden="true">
      <div className="pm-chart-frame__y">
        {yTicks.map((tick) => (
          <span key={tick.at} className="pm-chart-frame__tick pm-num" style={{ top: percentOf(tick.at, height) }}>
            {tick.label}
          </span>
        ))}
      </div>
      <div className="pm-chart-frame__plot">
        {svg}
        {firstBand !== undefined && provisionalLabel ? (
          <span className="pm-chart-frame__band-label" style={{ left: percentOf(firstBand.x1, width) }}>
            {provisionalLabel}
          </span>
        ) : null}
      </div>
      <div className="pm-chart-frame__x">
        {xTicks.map((tick) => (
          <span key={`${tick.at}:${tick.label}`} className="pm-chart-frame__tick" style={{ left: percentOf(tick.at, width) }}>
            {tick.label}
          </span>
        ))}
      </div>
    </div>
  );
}
