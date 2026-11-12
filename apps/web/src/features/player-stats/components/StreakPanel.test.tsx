/**
 * Unit tests for the streak panel.
 *
 * Three clauses of Requirement 9 are observable in this component, and each has
 * a failure mode worth pinning:
 *
 *   - both streaks render as whole numbers exactly as parsed, each with a text
 *     label naming which streak it is (9.1) — the failure mode is a figure
 *     reformatted on the way to the screen,
 *   - the two values are separately labelled, so neither can be mistaken for the
 *     other (9.2) — the failure mode is one shared label, or a label associated
 *     with the wrong figure once the layout wraps,
 *   - a zero value is rendered **together with** the no-run-recorded statement
 *     rather than omitted (9.3) — which has two failure modes, dropping the
 *     figure and dropping the sentence, so both halves are asserted, and the
 *     mixed case (one streak zero, one not) is asserted too because that is
 *     where a statement rendered once for the whole panel would show up.
 *
 * The label/figure association is read through the description list rather than
 * through document order: `dt` to `dd` is the association the markup actually
 * declares, and it is what a screen reader announces, so asserting it is
 * asserting what a person gets rather than what the stylesheet happens to show.
 *
 * Feature: web-player-stats-screen
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import {
  STREAK_PANEL_SELECTOR,
  STREAK_VALUE_SELECTOR,
  StreakPanel,
  type StreakKind,
} from './StreakPanel';
import {
  NO_RUN_RECORDED_STATEMENT,
  UNBEATEN_STREAK_LABEL,
  WIN_STREAK_LABEL,
} from '../lib/messages';

/** The label each streak is expected to be rendered with. */
const EXPECTED_LABELS: Record<StreakKind, string> = {
  win: WIN_STREAK_LABEL,
  unbeaten: UNBEATEN_STREAK_LABEL,
};

/** The counts a streak can arrive as, including both ends of the range. */
const STREAK_COUNTS = [0, 1, 2, 7, 13, 400, 1_000_000] as const;

/** The value of one streak, read by kind rather than by position. */
function streakValue(container: HTMLElement, kind: StreakKind): HTMLElement {
  const value = container.querySelector<HTMLElement>(
    `[data-player-stats-streak="${kind}"]`,
  );

  expect(value).not.toBeNull();

  return value as HTMLElement;
}

/**
 * The text of the term a streak's value is described by — the `dt` immediately
 * preceding it in the description list.
 */
function labelOf(container: HTMLElement, kind: StreakKind): string {
  const term = streakValue(container, kind).previousElementSibling;

  expect(term?.tagName).toBe('DT');

  return term?.textContent ?? '';
}

describe('StreakPanel values (Req 9.1)', () => {
  it.each(STREAK_COUNTS)('renders a winning run of %i exactly as parsed', (count) => {
    const { container } = render(
      <StreakPanel winStreak={count} unbeatenStreak={0} />,
    );

    expect(streakValue(container, 'win')).toHaveTextContent(String(count));
  });

  it.each(STREAK_COUNTS)('renders an unbeaten run of %i exactly as parsed', (count) => {
    const { container } = render(
      <StreakPanel winStreak={0} unbeatenStreak={count} />,
    );

    expect(streakValue(container, 'unbeaten')).toHaveTextContent(String(count));
  });

  it('renders a large count without a grouping separator', () => {
    const { container } = render(
      <StreakPanel winStreak={1_000_000} unbeatenStreak={1_234} />,
    );

    expect(streakValue(container, 'win').textContent).toContain('1000000');
    expect(streakValue(container, 'unbeaten').textContent).toContain('1234');
  });

  it('labels both streaks in text', () => {
    render(<StreakPanel winStreak={4} unbeatenStreak={9} />);

    expect(screen.getByText(WIN_STREAK_LABEL)).toBeVisible();
    expect(screen.getByText(UNBEATEN_STREAK_LABEL)).toBeVisible();
  });
});

describe('StreakPanel separate labelling (Req 9.2)', () => {
  it('renders exactly two labelled values', () => {
    const { container } = render(
      <StreakPanel winStreak={4} unbeatenStreak={9} />,
    );

    expect(container.querySelectorAll(STREAK_VALUE_SELECTOR)).toHaveLength(2);
  });

  it('gives the two streaks different labels', () => {
    expect(EXPECTED_LABELS.win).not.toBe(EXPECTED_LABELS.unbeaten);
  });

  it.each(['win', 'unbeaten'] as const)(
    'associates the %s run with its own label',
    (kind) => {
      const { container } = render(
        <StreakPanel winStreak={4} unbeatenStreak={9} />,
      );

      expect(labelOf(container, kind)).toBe(EXPECTED_LABELS[kind]);
    },
  );

  it('keeps the two differing figures with their own labels', () => {
    const { container } = render(
      <StreakPanel winStreak={4} unbeatenStreak={9} />,
    );

    expect(streakValue(container, 'win')).toHaveTextContent('4');
    expect(streakValue(container, 'unbeaten')).toHaveTextContent('9');
  });
});

describe('StreakPanel zero runs (Req 9.3)', () => {
  it('renders the zero itself rather than omitting it', () => {
    const { container } = render(
      <StreakPanel winStreak={0} unbeatenStreak={0} />,
    );

    expect(streakValue(container, 'win')).toHaveTextContent('0');
    expect(streakValue(container, 'unbeaten')).toHaveTextContent('0');
  });

  it('states that no run has been recorded for each zero', () => {
    render(<StreakPanel winStreak={0} unbeatenStreak={0} />);

    expect(screen.getAllByText(NO_RUN_RECORDED_STATEMENT)).toHaveLength(2);
  });

  it.each(['win', 'unbeaten'] as const)(
    'keeps the statement inside the %s entry',
    (kind) => {
      const { container } = render(
        <StreakPanel winStreak={0} unbeatenStreak={0} />,
      );

      expect(streakValue(container, kind)).toHaveTextContent(
        NO_RUN_RECORDED_STATEMENT,
      );
    },
  );

  it.each([
    { what: 'the winning run alone', winStreak: 0, unbeatenStreak: 6, zero: 'win' },
    {
      what: 'the unbeaten run alone',
      winStreak: 3,
      unbeatenStreak: 0,
      zero: 'unbeaten',
    },
  ] as const)(
    'states it for $what, and not for the other',
    ({ winStreak, unbeatenStreak, zero }) => {
      const { container } = render(
        <StreakPanel winStreak={winStreak} unbeatenStreak={unbeatenStreak} />,
      );

      const other: StreakKind = zero === 'win' ? 'unbeaten' : 'win';

      expect(screen.getAllByText(NO_RUN_RECORDED_STATEMENT)).toHaveLength(1);
      expect(streakValue(container, zero)).toHaveTextContent(
        NO_RUN_RECORDED_STATEMENT,
      );
      expect(streakValue(container, other)).not.toHaveTextContent(
        NO_RUN_RECORDED_STATEMENT,
      );
    },
  );

  it.each([1, 2, 7, 400] as const)(
    'states nothing for a run of %i',
    (count) => {
      render(<StreakPanel winStreak={count} unbeatenStreak={count} />);

      expect(screen.queryByText(NO_RUN_RECORDED_STATEMENT)).toBeNull();
    },
  );
});

describe('StreakPanel structure', () => {
  it('renders no heading, leaving the section heading to its wrapper', () => {
    render(<StreakPanel winStreak={0} unbeatenStreak={0} />);

    expect(screen.queryAllByRole('heading')).toHaveLength(0);
  });

  it('renders nothing activatable', () => {
    const { container } = render(
      <StreakPanel winStreak={4} unbeatenStreak={9} />,
    );

    const panel = container.querySelector(STREAK_PANEL_SELECTOR);

    expect(panel).not.toBeNull();
    expect(
      panel?.querySelectorAll('a, button, input, select, textarea, [tabindex]'),
    ).toHaveLength(0);
  });

  it('renders each pair as one of the list’s groups, a term then its description', () => {
    // A `div` grouping a name and its value is one of the content models HTML
    // gives a `dl`; each stat tile is one such group.
    const { container } = render(
      <StreakPanel winStreak={4} unbeatenStreak={0} />,
    );

    const panel = container.querySelector(STREAK_PANEL_SELECTOR);
    const groups = Array.from(panel?.children ?? []);

    expect(groups.map((group) => group.tagName)).toEqual(['DIV', 'DIV']);
    for (const group of groups) {
      expect(Array.from(group.children).map((child) => child.tagName)).toEqual(['DT', 'DD']);
    }
  });
});
