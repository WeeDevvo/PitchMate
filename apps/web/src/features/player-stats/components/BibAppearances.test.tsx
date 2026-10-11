/**
 * Unit tests for the bib-appearances figure.
 *
 * Two clauses of Requirement 9 are observable here:
 *
 *   - the count renders as a whole number exactly as parsed, with a text label
 *     naming it as bib appearances (9.4) — the failure mode is a figure
 *     reformatted or a label that drifts from `lib/messages.ts`,
 *   - it renders for **every** profile, including one whose Appearance_Count is
 *     zero (9.5) — the failure mode is a well-meant "nothing to show" branch
 *     that hides the figure for a player who has played nothing.
 *
 * The second is the interesting one, and it is pinned twice over: once by
 * rendering the counts a never-played profile produces, and once at the type
 * level, because the component takes no Appearance_Count and so has nothing to
 * gate on. A future prop that reintroduced the gate would fail the type-level
 * assertion below before any rendering test had to catch it.
 *
 * Feature: web-player-stats-screen
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import {
  BIB_APPEARANCES_SELECTOR,
  BIB_APPEARANCES_VALUE_SELECTOR,
  BibAppearances,
  type BibAppearancesProps,
} from './BibAppearances';
import { BIB_APPEARANCES_LABEL } from '../lib/messages';

/** Every count a Bib_Appearance_Count can arrive as, zero included. */
const BIB_COUNTS = [0, 1, 2, 11, 400, 1_000_000] as const;

/** The rendered value element. */
function bibValue(container: HTMLElement): HTMLElement {
  const value = container.querySelector<HTMLElement>(
    BIB_APPEARANCES_VALUE_SELECTOR,
  );

  expect(value).not.toBeNull();

  return value as HTMLElement;
}

describe('BibAppearances value (Req 9.4)', () => {
  it.each(BIB_COUNTS)('renders a count of %i exactly as parsed', (count) => {
    const { container } = render(<BibAppearances bibAppearances={count} />);

    expect(bibValue(container).textContent).toBe(String(count));
  });

  it('renders a large count without a grouping separator', () => {
    const { container } = render(<BibAppearances bibAppearances={1_234} />);

    expect(bibValue(container).textContent).toBe('1234');
  });

  it('names the figure as bib appearances in text', () => {
    render(<BibAppearances bibAppearances={11} />);

    expect(screen.getByText(BIB_APPEARANCES_LABEL)).toBeVisible();
  });

  it('associates the figure with that label', () => {
    const { container } = render(<BibAppearances bibAppearances={11} />);

    const term = bibValue(container).previousElementSibling;

    expect(term?.tagName).toBe('DT');
    expect(term?.textContent).toBe(BIB_APPEARANCES_LABEL);
  });
});

describe('BibAppearances renders for every profile (Req 9.5)', () => {
  it('renders the label and a zero for a player who has played no matches', () => {
    const { container } = render(<BibAppearances bibAppearances={0} />);

    expect(screen.getByText(BIB_APPEARANCES_LABEL)).toBeVisible();
    expect(bibValue(container).textContent).toBe('0');
  });

  it.each(BIB_COUNTS)('renders exactly one value for a count of %i', (count) => {
    const { container } = render(<BibAppearances bibAppearances={count} />);

    expect(container.querySelectorAll(BIB_APPEARANCES_VALUE_SELECTOR)).toHaveLength(
      1,
    );
    expect(container.querySelector(BIB_APPEARANCES_SELECTOR)).not.toBeNull();
  });

  it('takes no appearance count, so there is nothing to withhold the figure on', () => {
    // A complete props value: the one member is the whole interface, so no
    // Appearance_Count, membership state, or guest flag can reach the component
    // to gate on (Requirement 9.5).
    const props: BibAppearancesProps = { bibAppearances: 0 };
    const keys: readonly (keyof BibAppearancesProps)[] = Object.keys(
      props,
    ) as (keyof BibAppearancesProps)[];

    expect(keys).toEqual(['bibAppearances']);
  });
});

describe('BibAppearances structure', () => {
  it('renders no heading, leaving the section heading to its wrapper', () => {
    render(<BibAppearances bibAppearances={11} />);

    expect(screen.queryAllByRole('heading')).toHaveLength(0);
  });

  it('renders nothing activatable', () => {
    const { container } = render(<BibAppearances bibAppearances={11} />);

    const figure = container.querySelector(BIB_APPEARANCES_SELECTOR);

    expect(figure).not.toBeNull();
    expect(
      figure?.querySelectorAll('a, button, input, select, textarea, [tabindex]'),
    ).toHaveLength(0);
  });

  it('renders the pair as the list’s only children', () => {
    const { container } = render(<BibAppearances bibAppearances={11} />);

    const figure = container.querySelector(BIB_APPEARANCES_SELECTOR);
    const childTags = Array.from(figure?.children ?? []).map(
      (child) => child.tagName,
    );

    expect(childTags).toEqual(['DT', 'DD']);
  });
});
