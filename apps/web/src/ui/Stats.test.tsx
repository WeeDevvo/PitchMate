/**
 * The stats components: a stat tile as a label and value pair, a leaderboard
 * row's position, player and value, and the rating chart as a decorative plot
 * of the marks it is given.
 */
import { render, screen } from '@testing-library/react';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { LeaderboardRow, RatingChart, StatTile } from '.';

describe('StatTile', () => {
  it('pairs its label with its value inside a description list', () => {
    render(
      <dl>
        <StatTile label="Win rate" value="62%" sub="Of 24 games" />
      </dl>,
    );
    expect(screen.getByRole('term')).toHaveTextContent('Win rate');
    expect(screen.getByRole('definition')).toHaveTextContent('62%Of 24 games');
  });

  it('marks an absent figure as empty and a tone as a modifier', () => {
    const { container, rerender } = render(
      <dl>
        <StatTile label="Win rate" value="–" empty />
      </dl>,
    );
    expect(container.querySelector('.pm-stat')).toHaveClass('pm-stat--empty');
    rerender(
      <dl>
        <StatTile label="Bibs" value="3" tone="bib" icon="bib" />
      </dl>,
    );
    expect(container.querySelector('.pm-stat')).toHaveClass('pm-stat--bib');
    expect(container.querySelector('.pm-stat')).not.toHaveClass('pm-stat--empty');
  });

  it('passes attributes through to the label and the value', () => {
    render(
      <dl>
        <StatTile
          label="Longest win streak"
          value="4"
          labelProps={{ className: 'mine', 'data-hook': 'label' }}
          valueProps={{ 'data-hook': 'value' }}
        />
      </dl>,
    );
    expect(screen.getByRole('term')).toHaveClass('pm-stat__label', 'mine');
    expect(screen.getByRole('term')).toHaveAttribute('data-hook', 'label');
    expect(screen.getByRole('definition')).toHaveAttribute('data-hook', 'value');
  });
});

describe('LeaderboardRow', () => {
  it('reads as position, player, value', () => {
    render(
      <ol>
        <LeaderboardRow rank={1} first name={<a href="/p/1">Priya Shah</a>} value="1,240" unit="pts" />
      </ol>,
    );
    expect(screen.getByRole('listitem')).toHaveTextContent('1Priya Shah1,240pts');
    expect(screen.getByRole('link', { name: 'Priya Shah' })).toBeInTheDocument();
  });

  it('highlights only first place and only the viewer’s row', () => {
    const { container } = render(
      <ol>
        <LeaderboardRow rank={1} first name="A" value="9" />
        <LeaderboardRow rank={2} me name="B" value="7" />
      </ol>,
    );
    const rows = container.querySelectorAll('li');
    expect(rows[0]).toHaveClass('pm-lb--top1');
    expect(rows[0]).not.toHaveClass('pm-lb--me');
    expect(rows[1]).toHaveClass('pm-lb--me');
    expect(rows[1]).not.toHaveClass('pm-lb--top1');
  });
});

describe('RatingChart', () => {
  it('is hidden from assistive technology', () => {
    const { container } = render(
      <RatingChart width={100} height={40} polyline="0,30 50,20 100,10" marks={[]} />,
    );
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('draws one mark per reading, the latest filled, and a line only when given one', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 12 }), fc.boolean(), (count, withLine) => {
        const marks = Array.from({ length: count }, (_, index) => ({ key: `m${index}`, x: index * 10, y: index }));
        const { container, unmount } = render(
          <RatingChart
            width={120}
            height={40}
            gridLines={[{ x1: 0, x2: 120, y: 2 }, { x1: 0, x2: 120, y: 38 }]}
            polyline={withLine ? '0,0 10,1' : null}
            marks={marks}
            pointProps={(index) => ({ 'data-index': index } as never)}
          />,
        );
        const dots = container.querySelectorAll('circle.pm-chart__dot');
        expect(dots).toHaveLength(count);
        expect(container.querySelectorAll('.pm-chart__dot--last')).toHaveLength(1);
        expect(dots[count - 1]).toHaveClass('pm-chart__dot--last');
        expect(dots[count - 1]).toHaveAttribute('data-index', String(count - 1));
        expect(container.querySelectorAll('polyline')).toHaveLength(withLine ? 1 : 0);
        expect(container.querySelectorAll('line.pm-chart__grid')).toHaveLength(2);
        unmount();
      }),
      { numRuns: 30 },
    );
  });
});
