/**
 * Unit tests for the Result_Breakdown.
 *
 * The component's whole job is that each of wins, draws, and losses survives
 * without colour perception, so these tests pin the carriers rather than the
 * paint:
 *
 *   - three outcomes, in the order a football table reads them (6.2),
 *   - each carrying a letter, an icon glyph, a word, and its count (6.1, 6.2),
 *   - the letter and the icon hidden from assistive technology and the word
 *     present in it, so a screen reader hears "Wins 5" rather than "W 5" (16.6),
 *   - every count rendered through `formatCount`, exactly as parsed (6.1),
 *   - and no control, since the breakdown is a statistic and not an action.
 *
 * The division of labour between the letter and the hue — the letter in the body
 * text colour, the hue on the icon beside it (Requirement 15.5) — is a claim
 * about `ResultBreakdown.css` and about the token table it reads, which a jsdom
 * render cannot observe: `getComputedStyle` does not resolve a custom property
 * through a `var()` reference. What *is* observable here is that the meaning is
 * carried by three things other than colour, and that is what is asserted; the
 * token-level claim belongs to the feature's theming scan and its contrast audit.
 *
 * Feature: web-player-stats-screen
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import {
  RESULT_BREAKDOWN_ITEM_SELECTOR,
  RESULT_BREAKDOWN_SELECTOR,
  ResultBreakdown,
  type ResultOutcomeKind,
} from './ResultBreakdown';
import { DRAWS_LABEL, LOSSES_LABEL, WINS_LABEL } from '../lib/messages';
import { formatCount } from '../lib/numberFormat';

/** What each outcome is expected to render, in the order it renders it. */
interface ExpectedOutcome {
  readonly kind: ResultOutcomeKind;
  readonly letter: string;
  readonly icon: string;
  readonly label: string;
}

/** The three outcomes as the breakdown is expected to present them. */
const EXPECTED_OUTCOMES: readonly ExpectedOutcome[] = [
  { kind: 'win', letter: 'W', icon: '✓', label: WINS_LABEL },
  { kind: 'draw', letter: 'D', icon: '–', label: DRAWS_LABEL },
  { kind: 'loss', letter: 'L', icon: '✗', label: LOSSES_LABEL },
];

/** A record whose three counts are distinct, so a swap is observable. */
const DISTINCT_COUNTS = { wins: 7, draws: 3, losses: 12 } as const;

/** Anything a person could activate, so "renders no control" is checkable. */
const INTERACTIVE_SELECTOR =
  'a, button, input, select, textarea, summary, [role="button"], [role="link"],' +
  ' [role="menuitem"], [contenteditable], [tabindex]';

/** The rendered outcomes, in document order. */
function renderedItems(container: HTMLElement): readonly HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(RESULT_BREAKDOWN_ITEM_SELECTOR),
  );
}

/** The outcome kinds the breakdown rendered, in document order. */
function renderedKinds(container: HTMLElement): readonly string[] {
  return renderedItems(container).map(
    (item) => item.getAttribute('data-player-stats-result') ?? '',
  );
}

/** The item for one outcome kind. */
function itemFor(container: HTMLElement, kind: ResultOutcomeKind): HTMLElement {
  const item = container.querySelector<HTMLElement>(
    `[data-player-stats-result="${kind}"]`,
  );

  expect(item, `the ${kind} outcome must be rendered`).not.toBeNull();

  return item as HTMLElement;
}

describe('ResultBreakdown structure (Req 6.2)', () => {
  it('renders the three outcomes, in the order won, drawn, lost', () => {
    const { container } = render(<ResultBreakdown {...DISTINCT_COUNTS} />);

    expect(renderedKinds(container)).toEqual(['win', 'draw', 'loss']);
  });

  it('renders them as a list of three, in every browser', () => {
    render(<ResultBreakdown {...DISTINCT_COUNTS} />);

    // The role is stated explicitly because the stylesheet removes the markers,
    // and WebKit drops list semantics from a list styled that way.
    expect(screen.getByRole('list')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });
});

describe('ResultBreakdown carriers (Req 6.2, 16.6)', () => {
  it.each(EXPECTED_OUTCOMES)(
    'renders the $kind outcome as an icon, a letter, a word, and a count',
    ({ kind, letter, icon, label }) => {
      const { container } = render(<ResultBreakdown {...DISTINCT_COUNTS} />);

      const counts: Record<ResultOutcomeKind, number> = {
        win: DISTINCT_COUNTS.wins,
        draw: DISTINCT_COUNTS.draws,
        loss: DISTINCT_COUNTS.losses,
      };

      // Pins the four carriers and their order in one assertion: the hue is the
      // only thing left that is not asserted, which is the point of the design.
      expect(itemFor(container, kind).textContent).toBe(
        `${icon}${formatCount(counts[kind])}${letter}${label}`,
      );
    },
  );

  it.each(EXPECTED_OUTCOMES)(
    'hides the $kind letter and icon from assistive technology',
    ({ kind, letter, icon }) => {
      const { container } = render(<ResultBreakdown {...DISTINCT_COUNTS} />);
      const item = itemFor(container, kind);

      const hidden = Array.from(
        item.querySelectorAll('[aria-hidden="true"]'),
      ).map((element) => element.textContent);

      expect(hidden).toEqual([icon, letter]);
    },
  );

  it.each(EXPECTED_OUTCOMES)(
    'announces the $kind outcome by its word rather than by its letter',
    ({ kind, label }) => {
      const { container } = render(<ResultBreakdown {...DISTINCT_COUNTS} />);

      const word = screen.getByText(label);

      expect(word).toBeInTheDocument();
      expect(word.getAttribute('aria-hidden')).toBeNull();
      expect(itemFor(container, kind)).toContainElement(word);
    },
  );

  it('reads without colour: every outcome carries its meaning in text', () => {
    const { container } = render(<ResultBreakdown {...DISTINCT_COUNTS} />);

    for (const { kind, letter, label } of EXPECTED_OUTCOMES) {
      const text = itemFor(container, kind).textContent ?? '';

      expect(text).toContain(letter);
      expect(text).toContain(label);
    }
  });
});

describe('ResultBreakdown counts (Req 6.1)', () => {
  it.each([
    { what: 'a played record', wins: 7, draws: 3, losses: 12 },
    { what: 'all zeroes', wins: 0, draws: 0, losses: 0 },
    { what: 'a single win', wins: 1, draws: 0, losses: 0 },
    { what: 'a large tally', wins: 1234, draws: 56, losses: 789 },
    { what: 'the largest exact integer', wins: Number.MAX_SAFE_INTEGER, draws: 0, losses: 0 },
  ])('renders $what exactly as parsed', ({ wins, draws, losses }) => {
    const { container } = render(
      <ResultBreakdown wins={wins} draws={draws} losses={losses} />,
    );

    expect(itemFor(container, 'win').textContent).toContain(formatCount(wins));
    expect(itemFor(container, 'draw').textContent).toContain(formatCount(draws));
    expect(itemFor(container, 'loss').textContent).toContain(formatCount(losses));
  });

  it('renders no grouping separator in a four-figure tally', () => {
    const { container } = render(
      <ResultBreakdown wins={1234} draws={0} losses={0} />,
    );

    expect(itemFor(container, 'win').textContent).toContain('1234');
    expect(itemFor(container, 'win').textContent).not.toContain('1,234');
  });

  it('keeps the three counts with their own outcomes', () => {
    const { container } = render(<ResultBreakdown {...DISTINCT_COUNTS} />);

    // A component that read the wrong prop would still render three plausible
    // figures, so the counts are distinct and checked against each other.
    expect(itemFor(container, 'win').textContent).not.toContain('3');
    expect(itemFor(container, 'draw').textContent).not.toContain('7');
    expect(itemFor(container, 'loss').textContent).not.toContain('7');
  });
});

describe('ResultBreakdown renders no control', () => {
  it('renders nothing activatable', () => {
    const { container } = render(<ResultBreakdown {...DISTINCT_COUNTS} />);

    const breakdown = container.querySelector(RESULT_BREAKDOWN_SELECTOR);

    expect(breakdown).not.toBeNull();
    expect(breakdown?.querySelectorAll(INTERACTIVE_SELECTOR)).toHaveLength(0);
  });
});
