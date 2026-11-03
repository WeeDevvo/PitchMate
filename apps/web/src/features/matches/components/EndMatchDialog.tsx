/**
 * Full time: end a tracked match at its current score. Ending makes the
 * recorded events the result and completes the match, which applies the
 * rating update once, so it asks first and names the score.
 *
 * The server ends the match on the events it has, so ending waits until none
 * is still on its way. A match someone else ended meanwhile reads the same as
 * one ended here.
 */
import type { ReactElement } from 'react';

import { Banner, Button, Dialog } from '../../../ui';

import type { CallResult } from '../api/matchesApi';
import {
  END_MATCH_BODY,
  END_MATCH_DIALOG_TITLE,
  END_NEEDS_SYNC_STATEMENT,
  ENDING_LABEL,
  GENERIC_MATCHES_FAILURE,
  KEEP_PLAYING_LABEL,
  REJECTION_MESSAGES,
  endAtLabel,
} from '../lib/messages';
import type { TeamScore } from '../lib/parse/matchDetail';
import { useAction } from '../state/useAction';

export interface EndMatchDialogProps {
  readonly open: boolean;
  /** The score as shown, in team-sheet order, e.g. "3–2". */
  readonly score: string;
  /** True while events are still to be sent. */
  readonly unsynced: boolean;
  readonly finalise: (signal: AbortSignal) => Promise<CallResult<readonly TeamScore[]>>;
  readonly onClose: () => void;
  /** Called once the match has ended, here or elsewhere. */
  readonly onEnded: () => void;
}

export function EndMatchDialog({
  open,
  score,
  unsynced,
  finalise,
  onClose,
  onEnded,
}: EndMatchDialogProps): ReactElement {
  const action = useAction<readonly TeamScore[]>();

  const handleEnd = async (): Promise<void> => {
    if (action.busy || unsynced) return;
    const outcome = await action.run(finalise);
    if (outcome === null) return;
    // A match already over can no longer be tracked: either way, it has ended.
    if (outcome.kind === 'success' || (outcome.kind === 'rejected' && outcome.reason === 'invalid-state')) {
      onEnded();
    }
  };

  const outcome = action.outcome;
  const failure =
    outcome === null || outcome.kind === 'success'
      ? null
      : outcome.kind === 'rejected'
        ? REJECTION_MESSAGES[outcome.reason]
        : GENERIC_MATCHES_FAILURE;

  return (
    <Dialog
      open={open}
      title={END_MATCH_DIALOG_TITLE}
      icon="flag"
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            {KEEP_PLAYING_LABEL}
          </Button>
          <Button
            icon="flag"
            aria-disabled={action.busy || unsynced ? true : undefined}
            onClick={() => void handleEnd()}
          >
            {action.busy ? ENDING_LABEL : endAtLabel(score)}
          </Button>
        </>
      }
    >
      <p className="pm-dialog__body">{END_MATCH_BODY}</p>
      {unsynced ? <Banner tone="warn">{END_NEEDS_SYNC_STATEMENT}</Banner> : null}
      {failure === null ? null : <Banner tone="error">{failure}</Banner>}
    </Dialog>
  );
}

export default EndMatchDialog;
