/**
 * Unit tests for the Progression_Table.
 *
 * The table is the progression section's content and the accessible
 * representation of the chart beside it, so these tests pin the clauses of
 * Requirement 8 it carries:
 *
 *   - every plotted value is conveyed in text, so the series is readable without
 *     reference to the chart (8.4),
 *   - it is a real table with real headers, rendered visibly, so each figure is
 *     announced exactly once and with the column it belongs to (8.5),
 *   - an empty series renders the no-history statement and no table (8.6),
 *   - and each instant renders in a form determined solely by the instant, which
 *     is `formatInstantDate`'s fixed `D MMM YYYY` form (8.9).
 *
 * The formatters themselves are covered by Properties 23 and 24; what is
 * asserted here is that the table renders their output and nothing of its own.
 *
 * Feature: web-player-stats-screen
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import {
  PROGRESSION_DATE_HEADING,
  PROGRESSION_RATING_HEADING,
  PROGRESSION_ROW_SELECTOR,
  PROGRESSION_TABLE_SELECTOR,
  ProgressionTable,
} from './ProgressionTable';
import { formatInstantDate } from '../lib/instantFormat';
import { NO_RATING_HISTORY } from '../lib/messages';
import { formatCount } from '../lib/numberFormat';
import type { ProgressionPoint } from '../lib/parse/playerProfile';

/** 2026-01-01T00:00:00Z, which `formatInstantDate` renders as `1 Jan 2026`. */
const FIRST_INSTANT_MS = 1_767_225_600_000;

/** A week, so three matches fall on three distinct dates. */
const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

/** One point, so a case reads as the series it is about and nothing else. */
function point(instantMs: number, displayRating: number): ProgressionPoint {
  return { completedAtMs: instantMs, displayRating };
}

/** A three-match rising progression, in series order. */
const RISING_SERIES: readonly ProgressionPoint[] = [
  point(FIRST_INSTANT_MS, 1_180),
  point(FIRST_INSTANT_MS + MS_PER_WEEK, 1_205),
  point(FIRST_INSTANT_MS + 2 * MS_PER_WEEK, 1_240),
];

/** The rendered body rows, in document order. */
function rowsOf(container: HTMLElement): readonly Element[] {
  return Array.from(container.querySelectorAll(PROGRESSION_ROW_SELECTOR));
}

/** The two cell texts of one rendered row, in column order. */
function cellsOf(row: Element): readonly string[] {
  return Array.from(row.querySelectorAll('th, td')).map(
    (cell) => cell.textContent ?? '',
  );
}

describe('ProgressionTable structure (Req 8.5)', () => {
  it('renders a real table', () => {
    const { container } = render(<ProgressionTable series={RISING_SERIES} />);

    expect(container.querySelector(PROGRESSION_TABLE_SELECTOR)).not.toBeNull();
    expect(screen.getByRole('table')).toBeVisible();
  });

  it('renders the table visibly, rather than as a hidden accessible copy', () => {
    const { container } = render(<ProgressionTable series={RISING_SERIES} />);
    const table = container.querySelector(PROGRESSION_TABLE_SELECTOR);

    expect(table?.getAttribute('aria-hidden')).toBeNull();
    expect(table?.getAttribute('hidden')).toBeNull();
  });

  it('names both columns with a real column header', () => {
    render(<ProgressionTable series={RISING_SERIES} />);

    const headers = screen
      .getAllByRole('columnheader')
      .map((header) => header.textContent);

    expect(headers).toEqual([
      PROGRESSION_DATE_HEADING,
      PROGRESSION_RATING_HEADING,
    ]);
  });

  it('scopes each column header to its column', () => {
    render(<ProgressionTable series={RISING_SERIES} />);

    for (const header of screen.getAllByRole('columnheader')) {
      expect(header.getAttribute('scope')).toBe('col');
    }
  });

  it('makes each row identifiable by its date, as a row header', () => {
    render(<ProgressionTable series={RISING_SERIES} />);

    const rowHeaders = screen.getAllByRole('rowheader');

    expect(rowHeaders).toHaveLength(RISING_SERIES.length);

    for (const rowHeader of rowHeaders) {
      expect(rowHeader.getAttribute('scope')).toBe('row');
    }
  });

  it('renders exactly one header row and one row per point', () => {
    render(<ProgressionTable series={RISING_SERIES} />);

    expect(screen.getAllByRole('row')).toHaveLength(RISING_SERIES.length + 1);
  });
});

describe('ProgressionTable figures (Reqs 8.4, 8.9)', () => {
  it('renders one row per point, in the series order', () => {
    const { container } = render(<ProgressionTable series={RISING_SERIES} />);

    expect(rowsOf(container).map((row) => cellsOf(row))).toEqual(
      RISING_SERIES.map((plotted) => [
        formatInstantDate(plotted.completedAtMs),
        formatCount(plotted.displayRating),
      ]),
    );
  });

  it('renders each completion instant in the fixed D MMM YYYY form', () => {
    const { container } = render(<ProgressionTable series={RISING_SERIES} />);

    expect(rowsOf(container).map((row) => cellsOf(row)[0])).toEqual([
      '1 Jan 2026',
      '8 Jan 2026',
      '15 Jan 2026',
    ]);
  });

  it('renders the same text on a second render of the same series', () => {
    const first = render(<ProgressionTable series={RISING_SERIES} />);
    const second = render(<ProgressionTable series={RISING_SERIES} />);

    expect(
      second.container.querySelector(PROGRESSION_TABLE_SELECTOR)?.textContent,
    ).toBe(first.container.querySelector(PROGRESSION_TABLE_SELECTOR)?.textContent);
  });

  it.each([
    { what: 'a zero rating', displayRating: 0, expected: '0' },
    { what: 'a negative rating', displayRating: -12, expected: '-12' },
    { what: 'a four-figure rating', displayRating: 1_234, expected: '1234' },
    { what: 'a large rating', displayRating: 1_000_000, expected: '1000000' },
  ])(
    'renders $what exactly as the count formatter yields it',
    ({ displayRating, expected }) => {
      const { container } = render(
        <ProgressionTable series={[point(FIRST_INSTANT_MS, displayRating)]} />,
      );

      expect(rowsOf(container).map((row) => cellsOf(row)[1])).toEqual([expected]);
    },
  );

  it('renders two points sharing an instant and a rating as two rows', () => {
    const duplicated: readonly ProgressionPoint[] = [
      point(FIRST_INSTANT_MS, 1_200),
      point(FIRST_INSTANT_MS, 1_200),
    ];

    const { container } = render(<ProgressionTable series={duplicated} />);

    expect(rowsOf(container)).toHaveLength(2);
  });
});

describe('ProgressionTable with an empty series (Req 8.6)', () => {
  it('states that there is no rating history yet', () => {
    render(<ProgressionTable series={[]} />);

    expect(screen.getByText(NO_RATING_HISTORY)).toBeVisible();
  });

  it('renders no table, and so no empty set of headers', () => {
    const { container } = render(<ProgressionTable series={[]} />);

    expect(container.querySelector(PROGRESSION_TABLE_SELECTOR)).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryAllByRole('columnheader')).toHaveLength(0);
  });

  it('renders no row', () => {
    const { container } = render(<ProgressionTable series={[]} />);

    expect(rowsOf(container)).toHaveLength(0);
  });

  it('renders no figure', () => {
    const { container } = render(<ProgressionTable series={[]} />);

    expect(container.textContent).toBe(NO_RATING_HISTORY);
  });
});
