/**
 * The match components: the fairness meter's numbers and verdict, the day
 * picker as real checkboxes, the team column's heading and bibs flag, the
 * decorative scoreboard, and the match card's state chip.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import fc from 'fast-check';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { DayPicker, FairnessMeter, MatchCard, Scoreboard, TeamColumn } from '.';

describe('FairnessMeter', () => {
  it('reads each side either side of the draw, as text', () => {
    render(<FairnessMeter teamA="Red Wolves" teamB="Blue Herons" winA={0.46} winB={0.44} draw={0.1} drawLabel="A draw" />);
    const lines = screen
      .getAllByRole('term')
      .map((term) => `${term.textContent} ${term.nextElementSibling?.textContent}`);
    expect(lines).toEqual(['Red Wolves 46%', 'A draw 10%', 'Blue Herons 44%']);
  });

  it.each([
    [0.48, 0.46, 'Dead even'],
    [0.5, 0.41, 'Pretty fair'],
    [0.66, 0.26, 'Bit lopsided'],
  ])('calls %s against %s "%s"', (winA, winB, verdict) => {
    render(<FairnessMeter teamA="A" teamB="B" winA={winA} winB={winB} draw={1 - winA - winB} />);
    expect(screen.getByText(verdict)).toBeInTheDocument();
  });

  it('gives exactly one verdict for any split', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 100 }), (a, b) => {
        const { container, unmount } = render(
          <FairnessMeter teamA="A" teamB="B" winA={a / 100} winB={b / 100} draw={0} />,
        );
        expect(container.querySelectorAll('.pm-fair__verdict')).toHaveLength(1);
        unmount();
      }),
      { numRuns: 100 },
    );
  });

  it('shows whole percentages that always add up to 100, each within a point of its share', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1000 }),
        fc.integer({ min: 0, max: 1000 }),
        fc.integer({ min: 0, max: 1000 }),
        (rawA, rawDraw, rawB) => {
          const total = rawA + rawDraw + rawB;
          const [winA, draw, winB] = [rawA / total, rawDraw / total, rawB / total];
          const { unmount } = render(<FairnessMeter teamA="A" teamB="B" winA={winA} winB={winB} draw={draw} />);
          const shown = screen.getAllByRole('definition').map((value) => Number.parseInt(value.textContent ?? '', 10));
          expect(shown.reduce((sum, value) => sum + value, 0)).toBe(100);
          [winA, draw, winB].forEach((share, index) => expect(Math.abs(shown[index] - share * 100)).toBeLessThan(1));
          unmount();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rounds the screenshot case to 100 rather than 101', () => {
    // 51% / 49% wins with a 5% draw, as shares of the whole outcome.
    render(<FairnessMeter teamA="A" teamB="B" winA={0.51 * 0.95} winB={0.49 * 0.95} draw={0.05} />);
    expect(screen.getAllByRole('definition').map((value) => value.textContent)).toEqual(['48%', '5%', '47%']);
  });

  it('shows the side sizes only when the teams are uneven', () => {
    const { rerender } = render(<FairnessMeter teamA="A" teamB="B" winA={0.5} winB={0.4} draw={0.1} sizes={[7, 6]} />);
    expect(screen.getByText(/7/)).toBeInTheDocument();
    rerender(<FairnessMeter teamA="A" teamB="B" winA={0.5} winB={0.4} draw={0.1} sizes={[6, 6]} />);
    expect(screen.queryByText(/6/)).not.toBeInTheDocument();
  });
});

function DaysHarness() {
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <DayPicker
      days={[
        { id: 'sat', label: 'Sat 24 Oct, 19:00', dow: 'Sat', num: '24', mon: 'Oct', time: '19:00' },
        { id: 'sun', label: 'Sun 25 Oct, 10:00', dow: 'Sun', num: '25', mon: 'Oct' },
      ]}
      selected={selected}
      onToggle={(id, on) => setSelected((current) => (on ? [...current, id] : current.filter((day) => day !== id)))}
    />
  );
}

describe('DayPicker', () => {
  it('is a checkbox per day, named by the day in words, that toggles', async () => {
    render(<DaysHarness />);
    const saturday = screen.getByRole('checkbox', { name: 'Sat 24 Oct, 19:00' });
    expect(saturday).not.toBeChecked();
    await userEvent.click(saturday);
    expect(saturday).toBeChecked();
    expect(saturday.closest('.pm-day')).toHaveClass('is-selected');
    await userEvent.click(saturday);
    expect(saturday).not.toBeChecked();
  });

  it('keeps a time line on every tile when asked, blank until the day has a time', () => {
    const days = [
      { id: 'sat', label: 'Sat 24 Oct, 19:00', dow: 'Sat', num: '24', mon: 'Oct', time: '19:00' },
      { id: 'sun', label: 'Sun 25 Oct', dow: 'Sun', num: '25', mon: 'Oct' },
    ];
    const { container, rerender } = render(<DayPicker days={days} selected={[]} onToggle={() => {}} />);
    expect(Array.from(container.querySelectorAll('.pm-day__time'), (line) => line.textContent)).toEqual(['19:00']);

    rerender(<DayPicker days={days} selected={[]} onToggle={() => {}} reserveTime />);
    expect(Array.from(container.querySelectorAll('.pm-day__time'), (line) => line.textContent)).toEqual([
      '19:00',
      '',
    ]);
  });
});

describe('TeamColumn', () => {
  it('is a section named by its heading, carrying the bibs flag in the given words', () => {
    render(
      <TeamColumn side="a" aria-labelledby="t" sideLabel="Team A" bibs bibsLabel="Wears bibs" heading={<h3 id="t">Red Wolves</h3>}>
        <span>Player 1</span>
      </TeamColumn>,
    );
    const team = screen.getByRole('region', { name: 'Red Wolves' });
    expect(within(team).getByRole('img', { name: 'Wears bibs' })).toBeInTheDocument();
    expect(within(team).getByText('Player 1')).toBeInTheDocument();
  });

  it('carries no flag without the bibs', () => {
    render(<TeamColumn side="b" heading={<h3>Blue Herons</h3>} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});

describe('Scoreboard', () => {
  it('is decorative, leaving the words to the caller', () => {
    const { container } = render(<Scoreboard teamA="A" teamB="B" scoreA={3} scoreB={2} status="provisional" />);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
    expect(container.firstElementChild).toHaveClass('is-provisional');
    expect(container).toHaveTextContent('Provisional');
  });

  it('can leave the status out where the caller states it', () => {
    const { container } = render(
      <Scoreboard teamA="A" teamB="B" scoreA={1} scoreB={1} status="final" showStatus={false} />,
    );
    expect(container).not.toHaveTextContent('Full time');
  });
});

describe('MatchCard', () => {
  it('shows the title, facts and the state in the caller’s words', () => {
    render(
      <MatchCard
        title={<a href="/m">Goals, Pitch 4</a>}
        date={{ dow: 'Wed', num: '28', mon: 'Oct' }}
        state="rolled"
        stateLabel="Teams locked"
        meta={<span>11 players</span>}
      />,
    );
    expect(screen.getByRole('link', { name: 'Goals, Pitch 4' })).toBeInTheDocument();
    expect(screen.getByText('Teams locked')).toBeInTheDocument();
    expect(screen.getByText('11 players')).toBeInTheDocument();
  });
});
