/**
 * An organiser's marking of the days each guest can play, while availability
 * is being gathered. Guests have no account to answer with, so the organiser
 * answers for them; a marked guest counts towards a day's players and joins
 * the match when it is confirmed on that day.
 *
 * One row per active guest, each saved or cleared on its own, pre-ticked from
 * what was marked before. The days are sent back as the exact instants the
 * backend listed, as the caller's own availability form does.
 */
import { useId, useState, type FormEvent, type ReactElement } from 'react';

import type { CallResult } from '../api/matchesApi';
import { chronological, formatDay } from '../lib/matchDays';
import {
  CLEAR_GUEST_AVAILABILITY_LABEL,
  GENERIC_MATCHES_FAILURE,
  GUEST_AVAILABILITY_CLEARED_STATEMENT,
  GUEST_AVAILABILITY_HEADING,
  GUEST_AVAILABILITY_HINT,
  GUEST_AVAILABILITY_NO_GUESTS,
  GUEST_AVAILABILITY_NOT_MARKED,
  GUEST_AVAILABILITY_SAVED_STATEMENT,
  GUESTS_LOADING_LABEL,
  REJECTION_MESSAGES,
  SAVE_GUEST_AVAILABILITY_LABEL,
  SAVING_AVAILABILITY_LABEL,
} from '../lib/messages';
import type { GuestAvailability } from '../lib/parse/matchDetail';
import type { SquadGuest } from '../lib/parse/teams';
import { useAction, type ActionOutcome } from '../state/useAction';

export interface GuestAvailabilityPanelProps {
  readonly candidateDaysMs: readonly number[];
  /** The squad's active guests, `null` while loading, or `'failed'`. */
  readonly guests: readonly SquadGuest[] | null | 'failed';
  /** What was marked for each guest before; a guest absent here has nothing marked. */
  readonly marked: readonly GuestAvailability[];
  readonly submit: (
    guestMembershipId: string,
    markedDays: readonly string[],
    signal: AbortSignal,
  ) => Promise<CallResult<void>>;
  readonly clear: (guestMembershipId: string, signal: AbortSignal) => Promise<CallResult<void>>;
  /** Called after a save or clear settles, so the screen can re-read. */
  readonly onSettled: () => void;
}

type LastWrite = 'saved' | 'cleared' | null;

function outcomeMessage(outcome: ActionOutcome<void> | null, last: LastWrite): string | null {
  if (outcome === null) return null;
  if (outcome.kind === 'success') {
    return last === 'cleared' ? GUEST_AVAILABILITY_CLEARED_STATEMENT : GUEST_AVAILABILITY_SAVED_STATEMENT;
  }
  if (outcome.kind === 'rejected') return REJECTION_MESSAGES[outcome.reason];
  return GENERIC_MATCHES_FAILURE;
}

interface GuestRowProps {
  readonly guest: SquadGuest;
  readonly candidateDaysMs: readonly number[];
  readonly stored: GuestAvailability | undefined;
  readonly submit: GuestAvailabilityPanelProps['submit'];
  readonly clear: GuestAvailabilityPanelProps['clear'];
  readonly onSettled: () => void;
}

function GuestRow({ guest, candidateDaysMs, stored, submit, clear, onSettled }: GuestRowProps): ReactElement {
  const idPrefix = useId();
  const [marked, setMarked] = useState<ReadonlySet<number>>(
    () => new Set(stored?.markedDaysMs ?? []),
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
    const outcome = await write.run((signal) => submit(guest.membershipId, days, signal));
    if (outcome !== null) onSettled();
  };

  const handleClear = async (): Promise<void> => {
    setLast('cleared');
    const outcome = await write.run((signal) => clear(guest.membershipId, signal));
    if (outcome !== null && outcome.kind === 'success') setMarked(new Set());
    if (outcome !== null) onSettled();
  };

  const message = outcomeMessage(write.outcome, last);

  return (
    <li className="matches-guest-availability__row" data-matches-guest-availability={guest.membershipId}>
      <form noValidate onSubmit={(event) => void handleSave(event)}>
        <fieldset className="matches-fieldset">
          <legend>{guest.displayName}</legend>
          {stored === undefined ? <p className="matches-hint">{GUEST_AVAILABILITY_NOT_MARKED}</p> : null}
          <ul className="matches-checklist matches-checklist--inline">
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
            aria-label={`${SAVE_GUEST_AVAILABILITY_LABEL}, ${guest.displayName}`}
            aria-disabled={write.busy ? true : undefined}
          >
            {write.busy && last === 'saved' ? SAVING_AVAILABILITY_LABEL : SAVE_GUEST_AVAILABILITY_LABEL}
          </button>
          {stored === undefined ? null : (
            <button
              type="button"
              className="matches-button"
              aria-label={`${CLEAR_GUEST_AVAILABILITY_LABEL}, ${guest.displayName}`}
              aria-disabled={write.busy ? true : undefined}
              onClick={() => void handleClear()}
            >
              {CLEAR_GUEST_AVAILABILITY_LABEL}
            </button>
          )}
        </div>
        <p className="matches-notice" role="status" aria-live="polite">
          {message}
        </p>
      </form>
    </li>
  );
}

export function GuestAvailabilityPanel({
  candidateDaysMs,
  guests,
  marked,
  submit,
  clear,
  onSettled,
}: GuestAvailabilityPanelProps): ReactElement {
  const headingId = useId();
  const storedFor = new Map(marked.map((entry) => [entry.membershipId.toLowerCase(), entry]));

  let body: ReactElement;
  if (guests === 'failed') {
    body = <p className="matches-hint">{GENERIC_MATCHES_FAILURE}</p>;
  } else if (guests === null) {
    body = (
      <p className="matches-hint" role="status">
        {GUESTS_LOADING_LABEL}
      </p>
    );
  } else if (guests.length === 0) {
    body = <p className="matches-hint">{GUEST_AVAILABILITY_NO_GUESTS}</p>;
  } else {
    body = (
      <ul className="matches-guest-availability">
        {guests.map((guest) => (
          <GuestRow
            key={guest.membershipId}
            guest={guest}
            candidateDaysMs={candidateDaysMs}
            stored={storedFor.get(guest.membershipId.toLowerCase())}
            submit={submit}
            clear={clear}
            onSettled={onSettled}
          />
        ))}
      </ul>
    );
  }

  return (
    <section className="matches-panel" aria-labelledby={headingId}>
      <h2 id={headingId} className="matches-subheading">
        {GUEST_AVAILABILITY_HEADING}
      </h2>
      <p className="matches-hint">{GUEST_AVAILABILITY_HINT}</p>
      {body}
    </section>
  );
}

export default GuestAvailabilityPanel;
