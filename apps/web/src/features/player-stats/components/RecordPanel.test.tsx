/**
 * Unit tests for the record panel.
 *
 * The panel is where a reader meets the first figures on the screen, so these
 * tests pin each clause of Requirement 6 that is observable in it:
 *
 *   - the four counts rendered as whole numbers exactly as parsed (6.1),
 *   - the Result_Breakdown rendered once, with its own carriers intact (6.2),
 *   - the Win_Percentage with exactly one decimal place and a percentage
 *     indication (6.3),
 *   - the `NO_WIN_PERCENTAGE` statement and **no numeric percentage, not even a
 *     zero**, where the profile carries none or the formatter declines it (6.4),
 *   - the no-matches-played statement where the Appearance_Count is zero, with
 *     every figure still rendered rather than omitted (6.6),
 *   - each labelled figure programmatically associated with its own label (16.6),
 *   - and no control, since a record is read and never acted upon.
 *
 * The "no numeric percentage" cases are asserted as the absence of **any digit**
 * in the percentage figure rather than as the absence of the string `'0.0%'`: a
 * panel that rendered `'0%'`, `'0'`, or a clamped `'100.0%'` for an out-of-range
 * value would pass the narrower check while breaking the requirement.
 *
 * Feature: web-player-stats-screen
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import {
  RECORD_FIGURE_SELECTOR,
  RECORD_PANEL_SELECTOR,
  RecordPanel,
  type RecordFigureKind,
} from './RecordPanel';
import { RESULT_BREAKDOWN_SELECTOR } from './ResultBreakdown';
import {
  APPEARANCES_LABEL,
  NO_MATCHES_PLAYED_STATEMENT,
  NO_WIN_PERCENTAGE,
  WIN_PERCENTAGE_LABEL,
} from '../lib/messages';
import { formatCount } from '../lib/numberFormat';
import { type PlayerRecord } from '../lib/parse/playerProfile';

/** A record of a player who has played: twelve matches, mixed outcomes. */
const PLAYED_RECORD: PlayerRecord = {
  appearances: 12,
  wins: 7,
  draws: 2,
  losses: 3,
};

/** A record of a player who has never played: four zeroes. */
const UNPLAYED_RECORD: PlayerRecord = {
  appearances: 0,
  wins: 0,
  draws: 0,
  losses: 0,
};

/** Anything a person could activate, so "renders no control" is checkable. */
const INTERACTIVE_SELECTOR =
  'a, button, input, select, textarea, summary, [role="button"], [role="link"],' +
  ' [role="menuitem"], [contenteditable], [tabindex]';

/** The figure block for one kind. */
function figureFor(container: HTMLElement, kind: RecordFigureKind): HTMLElement {
  const figure = container.querySelector<HTMLElement>(
    `[data-player-stats-figure="${kind}"]`,
  );

  expect(figure, `the ${kind} figure must be rendered`).not.toBeNull();

  return figure as HTMLElement;
}

/** The label and the value text of one labelled figure. */
function figureTexts(
  container: HTMLElement,
  kind: RecordFigureKind,
): { readonly label: string; readonly value: string } {
  const figure = figureFor(container, kind);

  return {
    label: figure.querySelector('dt')?.textContent ?? '',
    value: figure.querySelector('dd')?.textContent ?? '',
  };
}

/** The digits a text carries, so "no numeric value" can be asserted directly. */
function digitsIn(text: string): readonly string[] {
  return [...text].filter((character) => /\p{Nd}/u.test(character));
}

describe('RecordPanel counts (Req 6.1)', () => {
  it.each([
    { what: 'a played record', record: PLAYED_RECORD },
    { what: 'an unplayed record', record: UNPLAYED_RECORD },
    {
      what: 'a long career',
      record: { appearances: 1234, wins: 600, draws: 134, losses: 500 },
    },
    {
      what: 'a record whose counts do not sum to its appearances',
      record: { appearances: 5, wins: 99, draws: 0, losses: 1 },
    },
  ])('renders the appearance count of $what exactly as parsed', ({ record }) => {
    const { container } = render(
      <RecordPanel record={record} winPercentage={50} />,
    );

    // Nothing is recomputed from the outcomes: the parser read four independent
    // counts and the panel renders the one it was given.
    expect(figureTexts(container, 'appearances').value).toBe(
      formatCount(record.appearances),
    );
  });

  it('labels the appearance count', () => {
    const { container } = render(
      <RecordPanel record={PLAYED_RECORD} winPercentage={58.3} />,
    );

    expect(figureTexts(container, 'appearances').label).toBe(APPEARANCES_LABEL);
  });

  it('renders no grouping separator in a four-figure count', () => {
    const { container } = render(
      <RecordPanel
        record={{ appearances: 1234, wins: 0, draws: 0, losses: 0 }}
        winPercentage={0}
      />,
    );

    expect(figureTexts(container, 'appearances').value).toBe('1234');
  });
});

describe('RecordPanel result breakdown (Req 6.2)', () => {
  it('renders exactly one breakdown, carrying the three outcome counts', () => {
    const { container } = render(
      <RecordPanel record={PLAYED_RECORD} winPercentage={58.3} />,
    );

    const breakdowns = container.querySelectorAll(RESULT_BREAKDOWN_SELECTOR);

    expect(breakdowns).toHaveLength(1);

    const text = breakdowns[0]?.textContent ?? '';

    expect(text).toContain('W');
    expect(text).toContain('D');
    expect(text).toContain('L');
    expect(text).toContain(formatCount(PLAYED_RECORD.wins));
    expect(text).toContain(formatCount(PLAYED_RECORD.draws));
    expect(text).toContain(formatCount(PLAYED_RECORD.losses));
  });
});

describe('RecordPanel win percentage (Req 6.3)', () => {
  it.each([
    { value: 58.3, expected: '58.3%' },
    { value: 0, expected: '0.0%' },
    { value: 100, expected: '100.0%' },
    { value: 33.333_333, expected: '33.3%' },
    { value: 66.666_666, expected: '66.7%' },
    { value: 50, expected: '50.0%' },
    { value: -0, expected: '0.0%' },
  ])('renders $value with one decimal place and a percentage sign', ({
    value,
    expected,
  }) => {
    const { container } = render(
      <RecordPanel record={PLAYED_RECORD} winPercentage={value} />,
    );

    expect(figureTexts(container, 'win-percentage').value).toBe(expected);
  });

  it('labels the win percentage without a sign of its own', () => {
    const { container } = render(
      <RecordPanel record={PLAYED_RECORD} winPercentage={58.3} />,
    );

    const { label } = figureTexts(container, 'win-percentage');

    expect(label).toBe(WIN_PERCENTAGE_LABEL);
    expect(label).not.toContain('%');
  });
});

describe('RecordPanel absent win percentage (Req 6.4)', () => {
  it.each([
    { what: 'a profile carrying none', value: null },
    { what: 'a value above the contract range', value: 100.1 },
    { what: 'a value below the contract range', value: -0.1 },
    { what: 'a value that is not a number', value: Number.NaN },
    { what: 'positive infinity', value: Number.POSITIVE_INFINITY },
    { what: 'negative infinity', value: Number.NEGATIVE_INFINITY },
  ])('states that there is no win percentage for $what', ({ value }) => {
    const { container } = render(
      <RecordPanel record={PLAYED_RECORD} winPercentage={value} />,
    );

    expect(figureTexts(container, 'win-percentage').value).toBe(NO_WIN_PERCENTAGE);
    expect(screen.getByText(NO_WIN_PERCENTAGE)).toBeVisible();
  });

  it.each([
    { what: 'a profile carrying none', value: null },
    { what: 'a value above the contract range', value: 100.1 },
    { what: 'a value that is not a number', value: Number.NaN },
  ])('renders no numeric percentage at all for $what, not even a zero', ({
    value,
  }) => {
    const { container } = render(
      <RecordPanel record={UNPLAYED_RECORD} winPercentage={value} />,
    );

    const { value: rendered } = figureTexts(container, 'win-percentage');

    expect(digitsIn(rendered)).toEqual([]);
    expect(rendered).not.toContain('%');
  });

  it('renders the statement and the sentence alike for both causes', () => {
    const { container: absent } = render(
      <RecordPanel record={PLAYED_RECORD} winPercentage={null} />,
    );
    const { container: declined } = render(
      <RecordPanel record={PLAYED_RECORD} winPercentage={100.1} />,
    );

    // An absent percentage and one the formatter declines are indistinguishable
    // on screen, so a figure outside the contract's range cannot be read as a
    // percentage that was earned.
    expect(figureTexts(absent, 'win-percentage').value).toBe(
      figureTexts(declined, 'win-percentage').value,
    );
  });
});

describe('RecordPanel with no matches played (Req 6.6)', () => {
  it('states that the player has played no matches in this squad yet', () => {
    render(<RecordPanel record={UNPLAYED_RECORD} winPercentage={null} />);

    expect(screen.getByText(NO_MATCHES_PLAYED_STATEMENT)).toBeVisible();
  });

  it('keeps every figure rendered rather than omitting them', () => {
    const { container } = render(
      <RecordPanel record={UNPLAYED_RECORD} winPercentage={null} />,
    );

    // The screen's shape does not change with its contents: the counts are
    // rendered as the zeroes they are, and the breakdown stays.
    expect(figureTexts(container, 'appearances').value).toBe('0');
    expect(container.querySelectorAll(RECORD_FIGURE_SELECTOR)).toHaveLength(2);
    expect(container.querySelectorAll(RESULT_BREAKDOWN_SELECTOR)).toHaveLength(1);
  });

  it('states it before the figures it explains', () => {
    const { container } = render(
      <RecordPanel record={UNPLAYED_RECORD} winPercentage={null} />,
    );

    const statement = screen.getByText(NO_MATCHES_PLAYED_STATEMENT);
    const appearances = figureFor(container, 'appearances');

    expect(
      statement.compareDocumentPosition(appearances) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeGreaterThan(0);
  });

  it.each([
    { what: 'one appearance', record: { ...PLAYED_RECORD, appearances: 1 } },
    { what: 'a full career', record: PLAYED_RECORD },
  ])('states nothing of the kind for $what', ({ record }) => {
    render(<RecordPanel record={record} winPercentage={58.3} />);

    expect(screen.queryByText(NO_MATCHES_PLAYED_STATEMENT)).toBeNull();
  });
});

describe('RecordPanel labelling and controls (Req 16.6)', () => {
  it('associates each figure with its own label', () => {
    const { container } = render(
      <RecordPanel record={PLAYED_RECORD} winPercentage={58.3} />,
    );

    for (const kind of ['appearances', 'win-percentage'] as const) {
      const { label, value } = figureTexts(container, kind);

      expect(label.length).toBeGreaterThan(0);
      expect(value.length).toBeGreaterThan(0);
    }
  });

  it.each([
    { what: 'a played record', record: PLAYED_RECORD, winPercentage: 58.3 },
    { what: 'an unplayed record', record: UNPLAYED_RECORD, winPercentage: null },
  ])('renders nothing activatable for $what', ({ record, winPercentage }) => {
    const { container } = render(
      <RecordPanel record={record} winPercentage={winPercentage} />,
    );

    const panel = container.querySelector(RECORD_PANEL_SELECTOR);

    expect(panel).not.toBeNull();
    expect(panel?.querySelectorAll(INTERACTIVE_SELECTOR)).toHaveLength(0);
  });
});
