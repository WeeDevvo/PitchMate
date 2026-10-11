/**
 * Unit tests for the section wrapper.
 *
 * Ten of the screen's regions render through this one component, so these tests
 * pin the two structural rules it exists to hold rather than re-asserting them
 * ten times later:
 *
 *   - a `section` that is a *named* landmark, its name taken from its own heading
 *     through `aria-labelledby` so the announced and the visible words are the
 *     same string (Requirement 16.3),
 *   - exactly one heading, always a level two, so the screen keeps the single
 *     level-one heading it owes and skips no level (Requirements 16.1, 16.2).
 *
 * Two sections rendered together are checked as well, because the heading ids are
 * generated and a collision would make both regions resolve their name from the
 * first heading — which is the failure mode that generating them avoids.
 *
 * Feature: web-player-stats-screen
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { STAT_SECTION_SELECTOR, StatSection } from './StatSection';

/** Two headings sharing a word, so a text-derived id would have collided. */
const FIRST_HEADING = 'Most played with';
const SECOND_HEADING = 'Most played against';

/** Stand-in body text, so "the content renders inside the region" is observable. */
const BODY_TEXT = 'Fourteen appearances';

describe('StatSection region (Req 16.3)', () => {
  it('renders a section element', () => {
    const { container } = render(<StatSection heading={FIRST_HEADING} />);

    expect(container.querySelector(STAT_SECTION_SELECTOR)?.tagName).toBe('SECTION');
  });

  it('exposes the section as a region named by its heading', () => {
    render(<StatSection heading={FIRST_HEADING} />);

    expect(screen.getByRole('region', { name: FIRST_HEADING })).toBeVisible();
  });

  it('names the region through its heading rather than through a duplicated label', () => {
    const { container } = render(<StatSection heading={FIRST_HEADING} />);

    const section = container.querySelector(STAT_SECTION_SELECTOR);
    const headingId = screen.getByRole('heading', { level: 2 }).id;

    expect(headingId).not.toBe('');
    expect(section).toHaveAttribute('aria-labelledby', headingId);
    expect(section).not.toHaveAttribute('aria-label');
  });

  it('renders its content inside the region', () => {
    render(
      <StatSection heading={FIRST_HEADING}>
        <p>{BODY_TEXT}</p>
      </StatSection>,
    );

    const region = screen.getByRole('region', { name: FIRST_HEADING });

    expect(region).toHaveTextContent(BODY_TEXT);
  });

  it('renders the heading alone when no content is supplied', () => {
    const { container } = render(<StatSection heading={FIRST_HEADING} />);

    expect(container.querySelector(STAT_SECTION_SELECTOR)?.textContent).toBe(
      FIRST_HEADING,
    );
  });
});

describe('StatSection heading level (Reqs 16.1, 16.2)', () => {
  it('renders exactly one heading', () => {
    render(
      <StatSection heading={FIRST_HEADING}>
        <p>{BODY_TEXT}</p>
      </StatSection>,
    );

    expect(screen.getAllByRole('heading')).toHaveLength(1);
  });

  it('renders that heading at level two', () => {
    render(<StatSection heading={FIRST_HEADING} />);

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
      FIRST_HEADING,
    );
  });

  it('renders no level-one heading, so the screen still owes exactly one elsewhere', () => {
    render(<StatSection heading={FIRST_HEADING} />);

    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });
});

describe('StatSection used more than once', () => {
  it('names each region from its own heading', () => {
    render(
      <>
        <StatSection heading={FIRST_HEADING} />
        <StatSection heading={SECOND_HEADING} />
      </>,
    );

    expect(screen.getByRole('region', { name: FIRST_HEADING })).toBeVisible();
    expect(screen.getByRole('region', { name: SECOND_HEADING })).toBeVisible();
  });

  it('generates distinct heading ids, so neither region borrows the other name', () => {
    render(
      <>
        <StatSection heading={FIRST_HEADING} />
        <StatSection heading={SECOND_HEADING} />
      </>,
    );

    const [first, second] = screen.getAllByRole('heading', { level: 2 });

    expect(first.id).not.toBe('');
    expect(second.id).not.toBe('');
    expect(first.id).not.toBe(second.id);
  });

  it('renders the sections in the order they were given', () => {
    const { container } = render(
      <>
        <StatSection heading={FIRST_HEADING} />
        <StatSection heading={SECOND_HEADING} />
      </>,
    );

    const sections = container.querySelectorAll(STAT_SECTION_SELECTOR);

    expect(sections).toHaveLength(2);
    expect(sections[0]).toHaveTextContent(FIRST_HEADING);
    expect(sections[1]).toHaveTextContent(SECOND_HEADING);
  });
});
