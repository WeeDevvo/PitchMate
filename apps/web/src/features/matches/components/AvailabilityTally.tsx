/**
 * How many can make each candidate day: a guide to the best day, not a gate.
 * The best-attended day is marked in words and with a mark, never by colour
 * alone.
 */
import { useId, type ReactElement } from 'react';

import { countsByDay, mostAvailableDays } from '../lib/availability';
import { formatDay } from '../lib/matchDays';
import { MOST_PLAYERS_LABEL, TALLY_HEADING, TALLY_HINT, tallyCountLabel } from '../lib/messages';
import type { DayTally } from '../lib/parse/responses';

export interface AvailabilityTallyProps {
  readonly candidateDaysMs: readonly number[];
  readonly tally: readonly DayTally[];
}

export function AvailabilityTally({ candidateDaysMs, tally }: AvailabilityTallyProps): ReactElement {
  const headingId = useId();
  const counts = countsByDay(candidateDaysMs, tally);
  const best = mostAvailableDays(counts);

  return (
    <section className="matches-panel" aria-labelledby={headingId}>
      <h2 id={headingId} className="matches-subheading">
        {TALLY_HEADING}
      </h2>
      <p className="matches-hint">{TALLY_HINT}</p>
      <ul className="matches-tally">
        {counts.map(({ dayMs, count }) => {
          const most = best.has(dayMs);
          return (
            <li key={dayMs} className="matches-tally__day" data-enough={most}>
              <time dateTime={new Date(dayMs).toISOString()}>{formatDay(dayMs)}</time>
              <span>{tallyCountLabel(count)}</span>
              {most ? (
                <span className="matches-chip">
                  <span aria-hidden="true">★ </span>
                  {MOST_PLAYERS_LABEL}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default AvailabilityTally;
