/**
 * Provisional readings in the progression section. A provisional point is
 * plotted at the backend's estimate with a dashed mark, the line through it is
 * dashed, and the table states it only as the design system's "~" band, never
 * as the precise figure; settled points are unchanged.
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

describe('provisional progression readings', () => {
  it('draws provisional marks dashed and settled marks plain', () => {
    const { container } = render(<ProgressionChart series={SETTLING_SERIES} />);
    const marks = Array.from(container.querySelectorAll(PROGRESSION_POINT_SELECTOR));

    expect(marks.map((mark) => mark.classList.contains('pm-chart__dot--prov'))).toEqual([
      true,
      true,
      false,
    ]);
  });

  it('dashes the line through the provisional run', () => {
    const { container } = render(<ProgressionChart series={SETTLING_SERIES} />);
    const chart = container.querySelector(PROGRESSION_CHART_SELECTOR);

    expect(chart?.querySelectorAll('.pm-chart__line--prov')).toHaveLength(1);
  });

  it('dashes nothing in a fully settled series', () => {
    const settled = SETTLING_SERIES.map((point) => ({ ...point, provisional: false }));
    const { container } = render(<ProgressionChart series={settled} />);

    expect(container.querySelectorAll('.pm-chart__line--prov')).toHaveLength(0);
  });

  it('states a provisional rating as the "~" band and never its figure', () => {
    const { container } = render(<ProgressionTable series={SETTLING_SERIES} />);
    const ratings = Array.from(container.querySelectorAll(PROGRESSION_ROW_SELECTOR)).map(
      (row) => row.querySelector('td')?.textContent ?? '',
    );

    expect(ratings[0]).toContain('~10xx');
    expect(ratings[0]).not.toContain('1062');
    expect(ratings[1]).toContain('~11xx');
    expect(ratings[1]).not.toContain('1124');
    expect(ratings[2]).toBe('1187');
  });
});
