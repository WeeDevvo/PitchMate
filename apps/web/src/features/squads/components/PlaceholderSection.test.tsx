/**
 * Worked examples for the Placeholder_Section (task 9.4).
 *
 * The generator-driven claim lives in `PlaceholderSection.property.test.tsx`;
 * this file pins the two concrete sections the Squad_Screen renders and the exact
 * copy each carries, which is the fact Requirement 15.2 fixes and which no
 * property quantifies over. It also checks the two structural details a reader
 * would want stated once rather than inferred from a generator: the heading comes
 * first in document order, and an injected body keeps its own DOM.
 *
 * Requirements: 15.1, 15.2, 15.3, 15.4, 15.6
 */
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';

import { PlaceholderSection } from './PlaceholderSection';
import {
  MATCHES_PLACEHOLDER_STATEMENT,
  STATS_PLACEHOLDER_STATEMENT,
} from '../lib/messages';

describe('PlaceholderSection', () => {
  // Requirements: 15.1, 15.2
  it('renders the matches section heading and its fixed statement', () => {
    render(
      <PlaceholderSection
        heading="Matches"
        emptyStatement={MATCHES_PLACEHOLDER_STATEMENT}
      />,
    );

    expect(
      screen.getByRole('heading', { level: 2, name: 'Matches' }),
    ).toBeInTheDocument();
    expect(screen.getByText(MATCHES_PLACEHOLDER_STATEMENT)).toBeInTheDocument();
    expect(screen.queryByText(STATS_PLACEHOLDER_STATEMENT)).toBeNull();
  });

  // Requirements: 15.1, 15.2
  it('renders the stats section heading and its fixed statement', () => {
    render(
      <PlaceholderSection
        heading="Stats and leaderboards"
        emptyStatement={STATS_PLACEHOLDER_STATEMENT}
      />,
    );

    expect(
      screen.getByRole('heading', { level: 2, name: 'Stats and leaderboards' }),
    ).toBeInTheDocument();
    expect(screen.getByText(STATS_PLACEHOLDER_STATEMENT)).toBeInTheDocument();
    expect(screen.queryByText(MATCHES_PLACEHOLDER_STATEMENT)).toBeNull();
  });

  // Requirements: 15.1, 15.4
  it('renders the heading before the body', () => {
    const { container } = render(
      <PlaceholderSection
        heading="Matches"
        emptyStatement={MATCHES_PLACEHOLDER_STATEMENT}
        content={<p>Injected body</p>}
      />,
    );

    const section = container.querySelector('section');
    expect(section).not.toBeNull();
    expect(Array.from(section?.children ?? []).map((child) => child.tagName)).toEqual(
      ['H2', 'P'],
    );
    expect(within(section as HTMLElement).getByText('Injected body')).toBeInTheDocument();
    expect(screen.queryByText(MATCHES_PLACEHOLDER_STATEMENT)).toBeNull();
  });

  // Requirements: 15.3, 15.4
  it('keeps the structure and controls of the injected body', () => {
    render(
      <PlaceholderSection
        heading="Stats and leaderboards"
        emptyStatement={STATS_PLACEHOLDER_STATEMENT}
        content={
          <div>
            <h3>Top scorers</h3>
            <button type="button">Refresh</button>
          </div>
        }
      />,
    );

    expect(
      screen.getByRole('heading', { level: 2, name: 'Stats and leaderboards' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Top scorers' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
    expect(screen.queryByText(STATS_PLACEHOLDER_STATEMENT)).toBeNull();
  });

  // Requirements: 15.6
  it('renders no level-one heading', () => {
    const { container } = render(
      <PlaceholderSection
        heading="Matches"
        emptyStatement={MATCHES_PLACEHOLDER_STATEMENT}
      />,
    );

    expect(container.querySelector('h1')).toBeNull();
    expect(screen.queryAllByRole('heading', { level: 1 })).toEqual([]);
  });
});
