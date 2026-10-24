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
}

/** One place in a leaderboard `ol`: position, player, value. */
export function LeaderboardRow({ rank, first, me, name, value, unit, className, ...rest }: LeaderboardRowProps) {
  return (
    <li {...rest} className={cx('pm-lb', first && 'pm-lb--top1', me && 'pm-lb--me', className)}>
      <span className="pm-lb__rank pm-num">{rank}</span>
      <span className="pm-lb__who">{name}</span>
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
  pointRadius?: number;
  /** Attributes for the line and for each point, such as test hooks. */
  lineProps?: SVGProps<SVGPolylineElement>;
  pointProps?: (index: number) => SVGProps<SVGCircleElement>;
}

/**
 * A rating line in the design system's chart style: frame lines, the line, and
 * a mark at each reading, the latest filled. It draws a plot it is given; the
 * geometry (scaling, degenerate series) is the caller's. Decorative: show the
 * readings as text beside it.
 */
export function RatingChart({
  width,
  height,
  gridLines = [],
  polyline,
  marks,
  pointRadius = 3.5,
  lineProps,
  pointProps,
  className,
  ...rest
}: RatingChartProps) {
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
      {...rest}
      className={cx('pm-chart', className)}
    >
      {gridLines.map((line) => (
        <line key={line.y} className="pm-chart__grid" x1={line.x1} y1={line.y} x2={line.x2} y2={line.y} />
      ))}
      {polyline === null ? null : <polyline {...lineProps} className="pm-chart__line" points={polyline} />}
      {marks.map((point, index) => (
        <circle
          key={point.key}
          {...pointProps?.(index)}
          className={cx('pm-chart__dot', index === marks.length - 1 && 'pm-chart__dot--last')}
          cx={point.x}
          cy={point.y}
          r={pointRadius}
        />
      ))}
    </svg>
  );
}
