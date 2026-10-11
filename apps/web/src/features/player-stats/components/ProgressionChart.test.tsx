/**
 * Unit tests for the Progression_Chart.
 *
 * The chart is the illustration of the progression section, so these tests pin
 * the clauses of Requirement 8 that are observable in the markup it produces:
 *
 *   - it is scalable vector graphics with a fixed `viewBox`, and there is no
 *     raster drawing surface and no measured size anywhere (8.2),
 *   - it is hidden from assistive technology and unfocusable, and it renders no
 *     text — so every figure is announced once, by the Progression_Table (8.5),
 *   - an empty series renders no chart and no empty set of axes (8.6),
 *   - a single point renders a mark and no line segment (8.7),
 *   - and each reading is carried by a position and a shape in addition to any
 *     colour (15.6).
 *
 * The coordinates themselves are the Chart_Geometry's business and are covered
 * by Properties 20 to 22 over arbitrary series; what is asserted here is that
 * the component renders the plot it is given, unaltered and in order.
 *
 * Feature: web-player-stats-screen
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import {
  PROGRESSION_CHART_HEIGHT,
  PROGRESSION_CHART_PADDING,
  PROGRESSION_CHART_SELECTOR,
  PROGRESSION_CHART_WIDTH,
  PROGRESSION_LINE_SELECTOR,
  PROGRESSION_POINT_SELECTOR,
  ProgressionChart,
} from './ProgressionChart';
import { ProgressionTable } from './ProgressionTable';
import { formatInstantDate } from '../lib/instantFormat';
import { formatCount } from '../lib/numberFormat';
import type { ProgressionPoint } from '../lib/parse/playerProfile';

/** 2026-01-01T00:00:00Z. */
const FIRST_INSTANT_MS = 1_767_225_600_000;

/** A week, so three matches fall on three distinct dates. */
const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

/** One point, so a case reads as the series it is about and nothing else. */
function point(instantMs: number, displayRating: number): ProgressionPoint {
  return { completedAtMs: instantMs, displayRating };
}

/** The first match of the generated history, and a series of just that match. */
const FIRST_POINT = point(FIRST_INSTANT_MS, 1_180);
const SINGLE_SERIES: readonly ProgressionPoint[] = [FIRST_POINT];

/** A three-match rising progression, in series order. */
const RISING_SERIES: readonly ProgressionPoint[] = [
  FIRST_POINT,
  point(FIRST_INSTANT_MS + MS_PER_WEEK, 1_205),
  point(FIRST_INSTANT_MS + 2 * MS_PER_WEEK, 1_240),
];

/** A three-match history that never moved, for the flat-domain case. */
const FLAT_SERIES: readonly ProgressionPoint[] = [
  point(FIRST_INSTANT_MS, 1_200),
  point(FIRST_INSTANT_MS + MS_PER_WEEK, 1_200),
  point(FIRST_INSTANT_MS + 2 * MS_PER_WEEK, 1_200),
];

/** The one rendered drawing, or a failure saying none was rendered. */
function chartOf(container: HTMLElement): Element {
  const chart = container.querySelector(PROGRESSION_CHART_SELECTOR);

  if (chart === null) {
    throw new Error('the chart rendered no drawing');
  }

  return chart;
}

/** The rendered point marks, in document order. */
function marksOf(container: HTMLElement): readonly Element[] {
  return Array.from(container.querySelectorAll(PROGRESSION_POINT_SELECTOR));
}

/** One numeric attribute of an element, as a number. */
function attributeNumber(element: Element, name: string): number {
  return Number(element.getAttribute(name));
}

describe('ProgressionChart drawing surface (Req 8.2)', () => {
  it('renders the plot as scalable vector graphics', () => {
    const { container } = render(<ProgressionChart series={RISING_SERIES} />);

    expect(chartOf(container).tagName.toLowerCase()).toBe('svg');
  });

  it('uses no raster drawing surface', () => {
    const { container } = render(<ProgressionChart series={RISING_SERIES} />);

    expect(container.querySelector('canvas')).toBeNull();
  });

  it('lays the drawing out in a fixed viewBox, in viewBox units', () => {
    const { container } = render(<ProgressionChart series={RISING_SERIES} />);

    expect(chartOf(container).getAttribute('viewBox')).toBe(
      `0 0 ${String(PROGRESSION_CHART_WIDTH)} ${String(PROGRESSION_CHART_HEIGHT)}`,
    );
  });

  it('states no width, height, or inline size of its own', () => {
    const { container } = render(<ProgressionChart series={RISING_SERIES} />);
    const chart = chartOf(container);

    expect(chart.getAttribute('width')).toBeNull();
    expect(chart.getAttribute('height')).toBeNull();
    expect(chart.getAttribute('style')).toBeNull();
  });

  it('renders the same viewBox for a one-point and a many-point series', () => {
    const single = render(<ProgressionChart series={SINGLE_SERIES} />);
    const many = render(<ProgressionChart series={RISING_SERIES} />);

    expect(chartOf(single.container).getAttribute('viewBox')).toBe(
      chartOf(many.container).getAttribute('viewBox'),
    );
  });
});

describe('ProgressionChart accessibility (Req 8.5)', () => {
  it('hides the drawing from assistive technology', () => {
    const { container } = render(<ProgressionChart series={RISING_SERIES} />);

    expect(chartOf(container).getAttribute('aria-hidden')).toBe('true');
  });

  it('declares the drawing unfocusable', () => {
    const { container } = render(<ProgressionChart series={RISING_SERIES} />);

    expect(chartOf(container).getAttribute('focusable')).toBe('false');
  });

  it('renders nothing focusable inside the hidden subtree', () => {
    const { container } = render(<ProgressionChart series={RISING_SERIES} />);

    expect(
      chartOf(container).querySelectorAll('[tabindex], a, button'),
    ).toHaveLength(0);
  });

  it('renders no text at all, so it can announce nothing', () => {
    const { container } = render(<ProgressionChart series={RISING_SERIES} />);
    const chart = chartOf(container);

    expect(chart.textContent).toBe('');
    expect(chart.querySelectorAll('text, title, desc')).toHaveLength(0);
  });

  it('carries no accessible name or description to be announced', () => {
    const { container } = render(<ProgressionChart series={RISING_SERIES} />);
    const chart = chartOf(container);

    expect(chart.getAttribute('aria-label')).toBeNull();
    expect(chart.getAttribute('aria-labelledby')).toBeNull();
    expect(chart.getAttribute('aria-describedby')).toBeNull();
  });

  it('leaves every figure to the table when both are rendered', () => {
    const { container } = render(
      <>
        <ProgressionChart series={RISING_SERIES} />
        <ProgressionTable series={RISING_SERIES} />
      </>,
    );

    const text = container.textContent ?? '';

    for (const plotted of RISING_SERIES) {
      // Split yields one more part than there are occurrences, so two parts is
      // exactly one announcement of that figure.
      expect(text.split(formatInstantDate(plotted.completedAtMs))).toHaveLength(2);
      expect(text.split(formatCount(plotted.displayRating))).toHaveLength(2);
    }
  });
});

describe('ProgressionChart with an empty series (Req 8.6)', () => {
  it('renders no chart', () => {
    const { container } = render(<ProgressionChart series={[]} />);

    expect(container.querySelector(PROGRESSION_CHART_SELECTOR)).toBeNull();
  });

  it('renders no axes, no grid rule, and no mark', () => {
    const { container } = render(<ProgressionChart series={[]} />);

    expect(
      container.querySelectorAll('svg, line, polyline, circle'),
    ).toHaveLength(0);
  });

  it('renders nothing at all', () => {
    const { container } = render(<ProgressionChart series={[]} />);

    expect(container.firstChild).toBeNull();
  });
});

describe('ProgressionChart line and marks (Reqs 8.7, 15.6)', () => {
  it('renders one mark per point', () => {
    const { container } = render(<ProgressionChart series={RISING_SERIES} />);

    expect(marksOf(container)).toHaveLength(RISING_SERIES.length);
  });

  it('renders each mark as a shape with a positive radius', () => {
    const { container } = render(<ProgressionChart series={RISING_SERIES} />);

    for (const mark of marksOf(container)) {
      expect(mark.tagName.toLowerCase()).toBe('circle');
      expect(attributeNumber(mark, 'r')).toBeGreaterThan(0);
    }
  });

  it('places the marks in the series order, left to right', () => {
    const { container } = render(<ProgressionChart series={RISING_SERIES} />);
    const horizontals = marksOf(container).map((mark) =>
      attributeNumber(mark, 'cx'),
    );

    expect(horizontals).toEqual([...horizontals].sort((left, right) => left - right));
  });

  it('places every mark inside the drawing box', () => {
    const { container } = render(<ProgressionChart series={RISING_SERIES} />);

    for (const mark of marksOf(container)) {
      const x = attributeNumber(mark, 'cx');
      const y = attributeNumber(mark, 'cy');

      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
      expect(x).toBeGreaterThanOrEqual(PROGRESSION_CHART_PADDING);
      expect(x).toBeLessThanOrEqual(
        PROGRESSION_CHART_WIDTH - PROGRESSION_CHART_PADDING,
      );
      expect(y).toBeGreaterThanOrEqual(PROGRESSION_CHART_PADDING);
      expect(y).toBeLessThanOrEqual(
        PROGRESSION_CHART_HEIGHT - PROGRESSION_CHART_PADDING,
      );
    }
  });

  it('renders a line through the points of a multi-point series', () => {
    const { container } = render(<ProgressionChart series={RISING_SERIES} />);
    const line = container.querySelector(PROGRESSION_LINE_SELECTOR);

    expect(line).not.toBeNull();
    expect(line?.tagName.toLowerCase()).toBe('polyline');
    expect(line?.getAttribute('points')?.split(' ')).toHaveLength(
      RISING_SERIES.length,
    );
  });

  it('renders the point but no line segment for a single reading', () => {
    const { container } = render(<ProgressionChart series={SINGLE_SERIES} />);

    expect(marksOf(container)).toHaveLength(1);
    expect(container.querySelector(PROGRESSION_LINE_SELECTOR)).toBeNull();
    expect(container.querySelectorAll('polyline')).toHaveLength(0);
  });

  it('renders a flat history as a flat line rather than failing (Req 8.8)', () => {
    const { container } = render(<ProgressionChart series={FLAT_SERIES} />);
    const verticals = marksOf(container).map((mark) =>
      attributeNumber(mark, 'cy'),
    );

    expect(verticals).toHaveLength(FLAT_SERIES.length);
    expect(verticals.every((value) => Number.isFinite(value))).toBe(true);
    expect(new Set(verticals).size).toBe(1);
    expect(container.querySelector(PROGRESSION_LINE_SELECTOR)).not.toBeNull();
  });
});
