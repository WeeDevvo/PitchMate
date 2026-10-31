/**
 * Who is playing. Everyone sees the list. While the match is confirmed, a
 * member can join or leave it themselves, and an organiser ticks anyone in the
 * squad, member or guest, in or out: each tick adds or removes that player at
 * once.
 */
import { useId, useState, type ReactElement } from 'react';

import { Banner, Button, Checkbox, GuestBadge, PlayerRow } from '../../../ui';

import type { CallResult } from '../api/matchesApi';
import {
  GENERIC_MATCHES_FAILURE,
  JOIN_MATCH_LABEL,
  LEAVE_MATCH_LABEL,
  NOT_PLAYING_STATEMENT,
  PARTICIPANTS_HEADING,
  PICK_PLAYERS_HINT,
  PLAYERS_LOADING_LABEL,
  PLAYING_STATEMENT,
  REJECTION_MESSAGES,
  WHO_IS_PLAYING_LEGEND,
  playingCountLabel,
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

interface Row {
  readonly membershipId: string;
  readonly displayName: string;
  readonly isGuest: boolean;
  readonly playing: boolean;
}

/** A tick the organiser just made, shown until the re-read list replaces the one it was made on. */
interface PendingTick {
  readonly listKey: string;
  readonly membershipId: string;
  readonly playing: boolean;
}

function failureMessage(outcome: ActionOutcome<void> | null): string | null {
  if (outcome === null || outcome.kind === 'success') return null;
  return outcome.kind === 'rejected' ? REJECTION_MESSAGES[outcome.reason] : GENERIC_MATCHES_FAILURE;
}

const idOf = (membershipId: string) => membershipId.toLowerCase();

/** Players in roster order, then everyone else in the squad in the squad's order. */
function rowsOf(participants: readonly Participant[], players: readonly SquadPlayer[]): readonly Row[] {
  const playing = [...participants]
    .sort((a, b) => a.rosterPosition - b.rosterPosition)
    .map((participant) => ({ ...participant, playing: true }));
  const taken = new Set(playing.map((row) => idOf(row.membershipId)));
  const others = players
    .filter((player) => !taken.has(idOf(player.membershipId)))
    .map((player) => ({ ...player, playing: false }));
  return [...playing, ...others];
}

export function ParticipantsPanel({ participants, self, editing }: ParticipantsPanelProps): ReactElement {
  const idPrefix = useId();
  const headingId = `${idPrefix}-heading`;
  const action = useAction<void>();
  const [pending, setPending] = useState<PendingTick | null>(null);

  const listKey = participants.map((participant) => participant.membershipId).join();
  const players = editing === undefined || typeof editing.players === 'string' ? [] : (editing.players ?? []);
  const rows = rowsOf(participants, players);
  const ticked = (row: Row): boolean =>
    pending !== null && pending.listKey === listKey && pending.membershipId === row.membershipId
      ? pending.playing
      : row.playing;

  const tick = async (row: Row, playing: boolean): Promise<void> => {
    if (editing === undefined || action.busy) return;
    setPending({ listKey, membershipId: row.membershipId, playing });
    const outcome = await action.run((signal) =>
      playing ? editing.addParticipant(row.membershipId, signal) : editing.remove(row.membershipId, signal),
    );
    if (outcome === null) return;
    if (outcome.kind !== 'success') setPending(null);
    editing.onSettled();
  };

  const toggleSelf = async (): Promise<void> => {
    if (self === undefined) return;
    const outcome = await action.run(self.isParticipant ? self.leave : self.join);
    if (outcome !== null) self.onSettled();
  };

  const failure = failureMessage(action.outcome);
  const list = (
    <ul className="matches-roster">
      {(editing === undefined ? rows.filter((row) => row.playing) : rows).map((row) => (
        <li key={row.membershipId}>
          <PlayerRow
            name={row.displayName}
            guest={row.isGuest}
            badges={row.isGuest ? <GuestBadge /> : undefined}
            end={
              editing === undefined ? undefined : (
                <Checkbox
                  label={row.displayName}
                  hideLabel
                  checked={ticked(row)}
                  onChange={(checked) => void tick(row, checked)}
                />
              )
            }
          />
        </li>
      ))}
    </ul>
  );

  return (
    <section className="matches-panel" aria-labelledby={headingId}>
      <div className="matches-panel__head">
        <h2 id={headingId} className="matches-subheading">
          {PARTICIPANTS_HEADING}
        </h2>
        <span className="matches-count pm-num">{playingCountLabel(participants.length)}</span>
      </div>

      {self === undefined ? null : (
        <div className="matches-self" data-matches-self-participation="true">
          <p>{self.isParticipant ? PLAYING_STATEMENT : NOT_PLAYING_STATEMENT}</p>
          <Button
            type="button"
            variant={self.isParticipant ? 'secondary' : 'primary'}
            icon={self.isParticipant ? 'logout' : 'userPlus'}
            aria-disabled={action.busy ? true : undefined}
            onClick={() => void toggleSelf()}
          >
            {self.isParticipant ? LEAVE_MATCH_LABEL : JOIN_MATCH_LABEL}
          </Button>
        </div>
      )}

      {editing === undefined ? (
        list
      ) : (
        <fieldset className="matches-fieldset">
          <legend className="matches-legend">{WHO_IS_PLAYING_LEGEND}</legend>
          <p className="matches-hint">{PICK_PLAYERS_HINT}</p>
          {list}
          {editing.players === 'failed' ? (
            <p className="matches-hint">{GENERIC_MATCHES_FAILURE}</p>
          ) : editing.players === null ? (
            <p className="matches-hint" role="status">
              {PLAYERS_LOADING_LABEL}
            </p>
          ) : null}
        </fieldset>
      )}

      {failure === null ? null : <Banner tone="error">{failure}</Banner>}
    </section>
  );
}

export default ParticipantsPanel;
