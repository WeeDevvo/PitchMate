/**
 * How many members can make each candidate day, against the threshold a day
 * needs before it can be confirmed. Whether a day has enough is stated in words
 * and with a mark, never by colour alone.
 */
import { useId, type ReactElement } from 'react';

import { countsByDay } from '../lib/availability';
import { formatDay } from '../lib/matchDays';
import {
  AT_THRESHOLD_LABEL,
  BELOW_THRESHOLD_LABEL,
  TALLY_HEADING,
  tallyCountLabel,
  thresholdStatement,
} from '../lib/messages';
import type { DayTally } from '../lib/parse/responses';

export interface AvailabilityTallyProps {
  readonly candidateDaysMs: readonly number[];
  readonly tally: readonly DayTally[];
  readonly threshold: number;
}

export function AvailabilityTally({
  candidateDaysMs,
  tally,
  threshold,
}: AvailabilityTallyProps): ReactElement {
  const headingId = useId();

  return (
    <section className="matches-panel" aria-labelledby={headingId}>
      <h2 id={headingId} className="matches-subheading">
        {TALLY_HEADING}
      </h2>
      <p className="matches-hint">{thresholdStatement(threshold)}</p>
      <ul className="matches-tally">
        {countsByDay(candidateDaysMs, tally).map(({ dayMs, count }) => {
          const enough = count >= threshold;
          return (
            <li key={dayMs} className="matches-tally__day" data-enough={enough}>
              <time dateTime={new Date(dayMs).toISOString()}>{formatDay(dayMs)}</time>
              <span>{tallyCountLabel(count, threshold)}</span>
              <span className="matches-chip">
                <span aria-hidden="true">{enough ? '✓ ' : '– '}</span>
                {enough ? AT_THRESHOLD_LABEL : BELOW_THRESHOLD_LABEL}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default AvailabilityTally;
