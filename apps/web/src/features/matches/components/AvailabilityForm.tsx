/**
 * The caller's own availability: one checkbox per candidate day, pre-ticked
 * from their stored response, saved as a whole or cleared.
 *
 * The days are sent back as the exact instants the backend listed, so each one
 * names a candidate day rather than a near miss.
 */
import { useId, useState, type FormEvent, type ReactElement } from 'react';

import type { CallResult } from '../api/matchesApi';
import { chronological, formatDay } from '../lib/matchDays';
import {
  AVAILABILITY_CLEARED_STATEMENT,
  AVAILABILITY_DAYS_LEGEND,
  AVAILABILITY_HEADING,
  AVAILABILITY_HINT,
  AVAILABILITY_NOT_RESPONDED,
  AVAILABILITY_SAVED_STATEMENT,
  CLEAR_AVAILABILITY_LABEL,
  GENERIC_MATCHES_FAILURE,
  REJECTION_MESSAGES,
  SAVE_AVAILABILITY_LABEL,
  SAVING_AVAILABILITY_LABEL,
} from '../lib/messages';
import type { CallerAvailability } from '../lib/parse/matchDetail';
import { useAction, type ActionOutcome } from '../state/useAction';

export interface AvailabilityFormProps {
  readonly candidateDaysMs: readonly number[];
  readonly availability: CallerAvailability;
  readonly submit: (markedDays: readonly string[], signal: AbortSignal) => Promise<CallResult<void>>;
  readonly clear: (signal: AbortSignal) => Promise<CallResult<void>>;
  /** Called after a save or clear settles, so the screen can re-read. */
  readonly onSettled: () => void;
}

type LastWrite = 'saved' | 'cleared' | null;

function outcomeMessage(outcome: ActionOutcome<void> | null, last: LastWrite): string | null {
  if (outcome === null) return null;
  if (outcome.kind === 'success') {
    return last === 'cleared' ? AVAILABILITY_CLEARED_STATEMENT : AVAILABILITY_SAVED_STATEMENT;
  }
  if (outcome.kind === 'rejected') return REJECTION_MESSAGES[outcome.reason];
  return GENERIC_MATCHES_FAILURE;
}

export function AvailabilityForm({
  candidateDaysMs,
  availability,
  submit,
  clear,
  onSettled,
}: AvailabilityFormProps): ReactElement {
  const idPrefix = useId();
  const headingId = `${idPrefix}-heading`;
  const hintId = `${idPrefix}-hint`;

  const [marked, setMarked] = useState<ReadonlySet<number>>(
    () => new Set(availability.markedDaysMs),
  );
  const [last, setLast] = useState<LastWrite>(null);
  const write = useAction<void>();

  const toggle = (dayMs: number, checked: boolean): void => {
    setMarked((current) => {
      const next = new Set(current);
      if (checked) next.add(dayMs);
      else next.delete(dayMs);
      return next;
    });
  };

  const handleSave = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const days = chronological([...marked]).map((dayMs) => new Date(dayMs).toISOString());
    setLast('saved');
    const outcome = await write.run((signal) => submit(days, signal));
    if (outcome !== null) onSettled();
  };

  const handleClear = async (): Promise<void> => {
    setLast('cleared');
    const outcome = await write.run(clear);
    if (outcome !== null && outcome.kind === 'success') setMarked(new Set());
    if (outcome !== null) onSettled();
  };

  const message = outcomeMessage(write.outcome, last);

  return (
    <section className="matches-panel" aria-labelledby={headingId}>
      <h2 id={headingId} className="matches-subheading">
        {AVAILABILITY_HEADING}
      </h2>
      <form noValidate onSubmit={(event) => void handleSave(event)}>
        <fieldset className="matches-fieldset" aria-describedby={hintId}>
          <legend className="matches-visually-hidden">{AVAILABILITY_DAYS_LEGEND}</legend>
          <p id={hintId} className="matches-hint">
            {AVAILABILITY_HINT}
          </p>
          {availability.hasStoredResponse ? null : (
            <p className="matches-hint">{AVAILABILITY_NOT_RESPONDED}</p>
          )}
          <ul className="matches-checklist">
            {chronological(candidateDaysMs).map((dayMs) => {
              const fieldId = `${idPrefix}-${dayMs}`;
              return (
                <li key={dayMs}>
                  <input
                    id={fieldId}
                    type="checkbox"
                    className="matches-checkbox"
                    checked={marked.has(dayMs)}
                    onChange={(event) => toggle(dayMs, event.target.checked)}
                  />
                  <label htmlFor={fieldId}>
                    <time dateTime={new Date(dayMs).toISOString()}>{formatDay(dayMs)}</time>
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
            aria-disabled={write.busy ? true : undefined}
          >
            {write.busy && last === 'saved' ? SAVING_AVAILABILITY_LABEL : SAVE_AVAILABILITY_LABEL}
          </button>
          {availability.hasStoredResponse ? (
            <button
              type="button"
              className="matches-button"
              aria-disabled={write.busy ? true : undefined}
              onClick={() => void handleClear()}
            >
              {CLEAR_AVAILABILITY_LABEL}
            </button>
          ) : null}
        </div>
        <p className="matches-notice" role="status" aria-live="polite">
          {message}
        </p>
      </form>
    </section>
  );
}

export default AvailabilityForm;
