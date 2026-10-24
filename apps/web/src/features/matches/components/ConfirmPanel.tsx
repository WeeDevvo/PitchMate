/**
 * The organiser's confirm step: choose one of the days that has reached the
 * threshold, and confirm the match on it. Days below the threshold are not
 * offered, because the backend would refuse them.
 */
import { useId, useState, type FormEvent, type ReactElement } from 'react';

import type { CallResult } from '../api/matchesApi';
import type { DayCount } from '../lib/availability';
import { formatDay } from '../lib/matchDays';
import {
  CONFIRM_DAY_LEGEND,
  CONFIRM_HEADING,
  CONFIRM_HINT,
  CONFIRM_LABEL,
  CONFIRMING_LABEL,
  GENERIC_MATCHES_FAILURE,
  NO_DAY_READY_STATEMENT,
  REJECTION_MESSAGES,
  tallyCountLabel,
} from '../lib/messages';
import { useAction } from '../state/useAction';

export interface ConfirmPanelProps {
  readonly dayCounts: readonly DayCount[];
  readonly threshold: number;
  readonly confirm: (day: string, signal: AbortSignal) => Promise<CallResult<void>>;
  /** Called after a confirm settles, so the screen can re-read. */
  readonly onSettled: () => void;
}

export function ConfirmPanel({
  dayCounts,
  threshold,
  confirm,
  onSettled,
}: ConfirmPanelProps): ReactElement {
  const idPrefix = useId();
  const headingId = `${idPrefix}-heading`;
  const ready = dayCounts.filter(({ count }) => count >= threshold);

  // The organiser's pick while it is still a ready day; otherwise the
  // best-attended ready day, the earliest of any tie.
  const [picked, setChosen] = useState<number | null>(null);
  const chosen = ready.some((day) => day.dayMs === picked)
    ? picked
    : ready.length === 0
      ? null
      : ready.reduce((best, day) => (day.count > best.count ? day : best)).dayMs;
  const action = useAction<void>();

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (chosen === null) return;
    const outcome = await action.run((signal) =>
      confirm(new Date(chosen).toISOString(), signal),
    );
    if (outcome !== null) onSettled();
  };

  const outcome = action.outcome;
  const failure =
    outcome === null || outcome.kind === 'success'
      ? null
      : outcome.kind === 'rejected'
        ? REJECTION_MESSAGES[outcome.reason]
        : GENERIC_MATCHES_FAILURE;

  return (
    <section className="matches-panel" aria-labelledby={headingId}>
      <h2 id={headingId} className="matches-subheading">
        {CONFIRM_HEADING}
      </h2>
      {ready.length === 0 ? (
        <p className="matches-hint">{NO_DAY_READY_STATEMENT}</p>
      ) : (
        <form noValidate onSubmit={(event) => void handleSubmit(event)}>
          <fieldset className="matches-fieldset">
            <legend>{CONFIRM_DAY_LEGEND}</legend>
            <p className="matches-hint">{CONFIRM_HINT}</p>
            <ul className="matches-checklist">
              {ready.map(({ dayMs, count }) => {
                const fieldId = `${idPrefix}-${dayMs}`;
                return (
                  <li key={dayMs}>
                    <input
                      id={fieldId}
                      type="radio"
                      name={`${idPrefix}-day`}
                      className="matches-checkbox"
                      checked={chosen === dayMs}
                      onChange={() => setChosen(dayMs)}
                    />
                    <label htmlFor={fieldId}>
                      <time dateTime={new Date(dayMs).toISOString()}>{formatDay(dayMs)}</time>
                      {' '}
                      <span className="matches-hint">({tallyCountLabel(count, threshold)})</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
          <div className="matches-actions">
            <button
              type="submit"
              className="matches-button matches-button--primary"
              aria-disabled={action.busy ? true : undefined}
            >
              {action.busy ? CONFIRMING_LABEL : CONFIRM_LABEL}
            </button>
          </div>
        </form>
      )}
      {failure === null ? null : (
        <p className="matches-error" role="alert">
          {failure}
        </p>
      )}
    </section>
  );
}

export default ConfirmPanel;
