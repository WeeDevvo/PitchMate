/**
 * Settling readings in the progression section. Every reading is plotted and
 * stated as a number. One taken while the rating was still settling is a hollow
 * mark on a dashed line in the chart, and the table shows its number like any
 * other with the settling note beside the date, never on the figure. Settled
 * readings are unchanged.
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import {
  PROGRESSION_CHART_SELECTOR,
  PROGRESSION_POINT_SELECTOR,
  ProgressionChart,
} from './ProgressionChart';
import { PROGRESSION_ROW_SELECTOR, ProgressionTable } from './ProgressionTable';
import type { ProgressionPoint } from '../lib/parse/playerProfile';

const DAY_MS = 24 * 60 * 60 * 1000;
const START_MS = 1_767_225_600_000;

const SETTLING_SERIES: readonly ProgressionPoint[] = [
  { completedAtMs: START_MS, displayRating: 1_062, provisional: true },
  { completedAtMs: START_MS + 7 * DAY_MS, displayRating: 1_124, provisional: true },
  { completedAtMs: START_MS + 14 * DAY_MS, displayRating: 1_187, provisional: false },
];

describe('settling progression readings', () => {
  it('draws settling marks hollow and settled marks plain', () => {
    const { container } = render(<ProgressionChart series={SETTLING_SERIES} />);
    const marks = Array.from(container.querySelectorAll(PROGRESSION_POINT_SELECTOR));

    expect(
      marks.map((mark) => mark.classList.contains('pm-chart__dot--settling')),
    ).toEqual([true, true, false]);
  });

  it('dashes the line through the settling run, in the chart’s own colour', () => {
    const { container } = render(<ProgressionChart series={SETTLING_SERIES} />);
    const chart = container.querySelector(PROGRESSION_CHART_SELECTOR);

    expect(chart?.querySelectorAll('.pm-chart__line--settling')).toHaveLength(1);
  });

  it('dashes nothing in a fully settled series', () => {
    const settled = SETTLING_SERIES.map((point) => ({ ...point, provisional: false }));
    const { container } = render(<ProgressionChart series={settled} />);

    expect(container.querySelectorAll('.pm-chart__line--settling')).toHaveLength(0);
    expect(container.querySelectorAll('.pm-chart__dot--settling')).toHaveLength(0);
  });

  it('shades no band and writes no "~" label on the chart', () => {
    const { container } = render(<ProgressionChart series={SETTLING_SERIES} />);

    expect(container.querySelector('.pm-chart__band')).toBeNull();
    expect(container.textContent ?? '').not.toContain('~');
    expect(container.textContent ?? '').not.toMatch(/provisional/iu);
  });

  it('states every reading as its number, settling or not', () => {
    const { container } = render(<ProgressionTable series={SETTLING_SERIES} />);
    const ratings = Array.from(container.querySelectorAll(PROGRESSION_ROW_SELECTOR)).map(
      (row) => row.querySelector('td')?.textContent ?? '',
    );

    expect(ratings).toEqual(['1062', '1124', '1187']);
  });

  it('draws a settling number exactly as a settled one', () => {
    const { container } = render(<ProgressionTable series={SETTLING_SERIES} />);
    const cells = Array.from(container.querySelectorAll(PROGRESSION_ROW_SELECTOR)).map(
      (row) => row.querySelector('td'),
    );
    const shapeOf = (cell: Element | null | undefined): string =>
      (cell?.innerHTML ?? '').replace(/\d+/gu, '#');

    expect(shapeOf(cells[0])).toBe(shapeOf(cells[2]));
  });

  it('says "Settling" beside the date of a settling reading, and nowhere else', () => {
    const { container } = render(<ProgressionTable series={SETTLING_SERIES} />);
    const dates = Array.from(container.querySelectorAll(PROGRESSION_ROW_SELECTOR)).map(
      (row) => row.querySelector('th')?.textContent ?? '',
    );

    expect(dates.map((date) => date.includes('Settling'))).toEqual([true, true, false]);
  });
});
