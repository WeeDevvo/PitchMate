/**
 * Who is playing. Everyone sees the list; while the match is confirmed, an
 * organiser can also remove a participant or add one of the squad's guests.
 */
import { useId, useState, type FormEvent, type ReactElement } from 'react';

import type { CallResult } from '../api/matchesApi';
import {
  ADD_GUEST_LABEL,
  ADD_GUEST_SUBMIT_LABEL,
  GENERIC_MATCHES_FAILURE,
  GUEST_LABEL,
  GUESTS_LOADING_LABEL,
  NO_GUESTS_TO_ADD,
  PARTICIPANTS_HEADING,
  REJECTION_MESSAGES,
  playerCountStatement,
  removeParticipantLabel,
} from '../lib/messages';
import type { Participant } from '../lib/parse/matchDetail';
import type { SquadGuest } from '../lib/parse/teams';
import { useAction, type ActionOutcome } from '../state/useAction';

export interface ParticipantsPanelProps {
  readonly participants: readonly Participant[];
  /** Present only when the caller may change the participants. */
  readonly editing?: {
    /** The squad's guests, `null` while they load, or `'failed'`. */
    readonly guests: readonly SquadGuest[] | null | 'failed';
    readonly addGuest: (membershipId: string, signal: AbortSignal) => Promise<CallResult<void>>;
    readonly remove: (membershipId: string, signal: AbortSignal) => Promise<CallResult<void>>;
    readonly onSettled: () => void;
  };
}

function failureMessage(outcome: ActionOutcome<void> | null): string | null {
  if (outcome === null || outcome.kind === 'success') return null;
  return outcome.kind === 'rejected' ? REJECTION_MESSAGES[outcome.reason] : GENERIC_MATCHES_FAILURE;
}

export function ParticipantsPanel({ participants, editing }: ParticipantsPanelProps): ReactElement {
  const idPrefix = useId();
  const headingId = `${idPrefix}-heading`;
  const selectId = `${idPrefix}-guest`;
  const action = useAction<void>();
  const [guestId, setGuestId] = useState('');

  const ordered = [...participants].sort((a, b) => a.rosterPosition - b.rosterPosition);
  const playing = new Set(participants.map((participant) => participant.membershipId));
  const guests = editing === undefined || typeof editing.guests === 'string' ? [] : (editing.guests ?? []);
  const addable = guests.filter((guest) => !playing.has(guest.membershipId));
  const selected = addable.some((guest) => guest.membershipId === guestId)
    ? guestId
    : (addable[0]?.membershipId ?? '');

  const remove = async (membershipId: string): Promise<void> => {
    if (editing === undefined) return;
    const outcome = await action.run((signal) => editing.remove(membershipId, signal));
    if (outcome !== null) editing.onSettled();
  };

  const handleAdd = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (editing === undefined || selected === '') return;
    const outcome = await action.run((signal) => editing.addGuest(selected, signal));
    if (outcome !== null) editing.onSettled();
  };

  const failure = failureMessage(action.outcome);

  return (
    <section className="matches-panel" aria-labelledby={headingId}>
      <h2 id={headingId} className="matches-subheading">
        {PARTICIPANTS_HEADING}
      </h2>
      <p className="matches-hint">{playerCountStatement(participants.length)}</p>
      <ul className="matches-people">
        {ordered.map((participant) => (
          <li key={participant.membershipId} className="matches-person">
            <span>
              {participant.displayName}
              {participant.isGuest ? <span className="matches-chip">{GUEST_LABEL}</span> : null}
            </span>
            {editing === undefined ? null : (
              <button
                type="button"
                className="matches-button"
                aria-disabled={action.busy ? true : undefined}
                onClick={() => void remove(participant.membershipId)}
              >
                {removeParticipantLabel(participant.displayName)}
              </button>
            )}
          </li>
        ))}
      </ul>

      {editing === undefined ? null : editing.guests === 'failed' ? (
        <p className="matches-hint">{GENERIC_MATCHES_FAILURE}</p>
      ) : editing.guests === null ? (
        <p className="matches-hint" role="status">
          {GUESTS_LOADING_LABEL}
        </p>
      ) : addable.length === 0 ? (
        <p className="matches-hint">{NO_GUESTS_TO_ADD}</p>
      ) : (
        <form className="matches-inline-form" noValidate onSubmit={(event) => void handleAdd(event)}>
          <label htmlFor={selectId}>{ADD_GUEST_LABEL}</label>
          <select
            id={selectId}
            className="matches-input"
            value={selected}
            onChange={(event) => setGuestId(event.target.value)}
          >
            {addable.map((guest) => (
              <option key={guest.membershipId} value={guest.membershipId}>
                {guest.displayName}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="matches-button"
            aria-disabled={action.busy ? true : undefined}
          >
            {ADD_GUEST_SUBMIT_LABEL}
          </button>
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

export default ParticipantsPanel;
