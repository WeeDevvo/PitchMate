/**
 * Undo a kickoff made by mistake: the match goes back to its locked teams,
 * ready to start again with a fresh clock. It asks first.
 *
 * The backend refuses once anything is recorded for the match (a live event or
 * a score), and that refusal is shown here with its reason. A match that has
 * moved on meanwhile reads as settled, so the screen can re-read.
 */
import type { ReactElement } from 'react';

import { Banner, Button, Dialog } from '../../../ui';

import type { CallResult } from '../api/matchesApi';
import {
  CONFIRM_UNDO_START_LABEL,
  GENERIC_MATCHES_FAILURE,
  KEEP_PLAYING_LABEL,
  REJECTION_MESSAGES,
  UNDO_START_DIALOG_BODY,
  UNDO_START_DIALOG_TITLE,
  UNDOING_START_LABEL,
} from '../lib/messages';
import { useAction } from '../state/useAction';

export interface UndoKickoffDialogProps {
  readonly open: boolean;
  readonly undoStart: (signal: AbortSignal) => Promise<CallResult<void>>;
  readonly onClose: () => void;
  /** Called once kickoff is undone, or the match has moved on. */
  readonly onSettled: () => void;
}

export function UndoKickoffDialog({ open, undoStart, onClose, onSettled }: UndoKickoffDialogProps): ReactElement {
  const action = useAction<void>();

  const handleUndo = async (): Promise<void> => {
    if (action.busy) return;
    const outcome = await action.run(undoStart);
    if (outcome === null) return;
    if (outcome.kind === 'success' || (outcome.kind === 'rejected' && outcome.reason === 'invalid-state')) {
      onSettled();
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
      title={UNDO_START_DIALOG_TITLE}
      icon="undo"
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            {KEEP_PLAYING_LABEL}
          </Button>
          <Button icon="undo" aria-disabled={action.busy ? true : undefined} onClick={() => void handleUndo()}>
            {action.busy ? UNDOING_START_LABEL : CONFIRM_UNDO_START_LABEL}
          </Button>
        </>
      }
    >
      <p className="pm-dialog__body">{UNDO_START_DIALOG_BODY}</p>
      {failure === null ? null : <Banner tone="error">{failure}</Banner>}
    </Dialog>
  );
}

export default UndoKickoffDialog;
