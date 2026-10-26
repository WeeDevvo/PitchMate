/**
 * Who is playing. Everyone sees the list. While the match is confirmed, a
 * member can join or leave it themselves, and an organiser can also add any
 * member or guest of the squad and remove anyone.
 */
import { useId, useState, type FormEvent, type ReactElement } from 'react';

import type { CallResult } from '../api/matchesApi';
import {
  ADD_PLAYER_LABEL,
  ADD_PLAYER_SUBMIT_LABEL,
  GENERIC_MATCHES_FAILURE,
  GUEST_LABEL,
  JOIN_MATCH_LABEL,
  LEAVE_MATCH_LABEL,
  NO_PLAYERS_TO_ADD,
  NOT_PLAYING_STATEMENT,
  PARTICIPANTS_HEADING,
  PLAYERS_LOADING_LABEL,
  PLAYING_STATEMENT,
  REJECTION_MESSAGES,
  guestOptionLabel,
  playerCountStatement,
  removeParticipantLabel,
} from '../lib/messages';
import type { Participant } from '../lib/parse/matchDetail';
import type { SquadPlayer } from '../lib/parse/teams';
import { useAction, type ActionOutcome } from '../state/useAction';

export interface ParticipantsPanelProps {
  readonly participants: readonly Participant[];
  /** Present only when the caller may join or leave the match themselves. */
  readonly self?: {
    readonly isParticipant: boolean;
    readonly join: (signal: AbortSignal) => Promise<CallResult<void>>;
    readonly leave: (signal: AbortSignal) => Promise<CallResult<void>>;
    readonly onSettled: () => void;
  };
  /** Present only when the caller may change the participants. */
  readonly editing?: {
    /** The squad's active members and guests, `null` while they load, or `'failed'`. */
    readonly players: readonly SquadPlayer[] | null | 'failed';
    readonly addParticipant: (membershipId: string, signal: AbortSignal) => Promise<CallResult<void>>;
    readonly remove: (membershipId: string, signal: AbortSignal) => Promise<CallResult<void>>;
    readonly onSettled: () => void;
  };
}

function failureMessage(outcome: ActionOutcome<void> | null): string | null {
  if (outcome === null || outcome.kind === 'success') return null;
  return outcome.kind === 'rejected' ? REJECTION_MESSAGES[outcome.reason] : GENERIC_MATCHES_FAILURE;
}

export function ParticipantsPanel({ participants, self, editing }: ParticipantsPanelProps): ReactElement {
  const idPrefix = useId();
  const headingId = `${idPrefix}-heading`;
  const selectId = `${idPrefix}-player`;
  const action = useAction<void>();
  const [playerId, setPlayerId] = useState('');

  const ordered = [...participants].sort((a, b) => a.rosterPosition - b.rosterPosition);
  const playing = new Set(participants.map((participant) => participant.membershipId.toLowerCase()));
  const players = editing === undefined || typeof editing.players === 'string' ? [] : (editing.players ?? []);
  const addable = players.filter((player) => !playing.has(player.membershipId.toLowerCase()));
  const selected = addable.some((player) => player.membershipId === playerId)
    ? playerId
    : (addable[0]?.membershipId ?? '');

  const remove = async (membershipId: string): Promise<void> => {
    if (editing === undefined) return;
    const outcome = await action.run((signal) => editing.remove(membershipId, signal));
    if (outcome !== null) editing.onSettled();
  };

  const handleAdd = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (editing === undefined || selected === '') return;
    const outcome = await action.run((signal) => editing.addParticipant(selected, signal));
    if (outcome !== null) editing.onSettled();
  };

  const toggleSelf = async (): Promise<void> => {
    if (self === undefined) return;
    const outcome = await action.run(self.isParticipant ? self.leave : self.join);
    if (outcome !== null) self.onSettled();
  };

  const failure = failureMessage(action.outcome);

  return (
    <section className="matches-panel" aria-labelledby={headingId}>
      <h2 id={headingId} className="matches-subheading">
        {PARTICIPANTS_HEADING}
      </h2>
      <p className="matches-hint">{playerCountStatement(participants.length)}</p>

      {self === undefined ? null : (
        <div className="matches-actions" data-matches-self-participation="true">
          <p className="matches-hint">{self.isParticipant ? PLAYING_STATEMENT : NOT_PLAYING_STATEMENT}</p>
          <button
            type="button"
            className={self.isParticipant ? 'matches-button' : 'matches-button matches-button--primary'}
            aria-disabled={action.busy ? true : undefined}
            onClick={() => void toggleSelf()}
          >
            {self.isParticipant ? LEAVE_MATCH_LABEL : JOIN_MATCH_LABEL}
          </button>
        </div>
      )}

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

      {editing === undefined ? null : editing.players === 'failed' ? (
        <p className="matches-hint">{GENERIC_MATCHES_FAILURE}</p>
      ) : editing.players === null ? (
        <p className="matches-hint" role="status">
          {PLAYERS_LOADING_LABEL}
        </p>
      ) : addable.length === 0 ? (
        <p className="matches-hint">{NO_PLAYERS_TO_ADD}</p>
      ) : (
        <form className="matches-inline-form" noValidate onSubmit={(event) => void handleAdd(event)}>
          <label htmlFor={selectId}>{ADD_PLAYER_LABEL}</label>
          <select
            id={selectId}
            className="matches-input"
            value={selected}
            onChange={(event) => setPlayerId(event.target.value)}
          >
            {addable.map((player) => (
              <option key={player.membershipId} value={player.membershipId}>
                {player.isGuest ? guestOptionLabel(player.displayName) : player.displayName}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="matches-button"
            aria-disabled={action.busy ? true : undefined}
          >
            {ADD_PLAYER_SUBMIT_LABEL}
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
