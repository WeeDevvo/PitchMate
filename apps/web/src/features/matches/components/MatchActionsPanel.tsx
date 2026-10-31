/**
 * The organiser's match-day steps before kick-off: start the match once its
 * teams are locked, or cancel it while it has not started.
 *
 * Starting checks first that the working teams are still the locked ones. The
 * locked line-up is what plays and is scored, so a change made after locking
 * and not locked again is pointed out rather than silently dropped. Cancelling
 * cannot be undone, so it asks again in a dialog.
 */
import { useId, useState, type ReactElement } from 'react';

import { Banner, Button, Dialog } from '../../../ui';

import type { CallResult } from '../api/matchesApi';
import { canCancel, canStart, workingTeamsAreLocked } from '../lib/lifecycle';
import {
  CANCEL_DIALOG_BODY,
  CANCEL_MATCH_LABEL,
  CANCELLING_LABEL,
  CONFIRM_CANCEL_LABEL,
  GENERIC_MATCHES_FAILURE,
  KEEP_MATCH_LABEL,
  MATCH_ACTIONS_HEADING,
  REJECTION_MESSAGES,
  START_HINT,
  START_MATCH_LABEL,
  STARTING_LABEL,
  UNLOCKED_CHANGES_STATEMENT,
  cancelDialogTitle,
} from '../lib/messages';
import type { TeamSheet } from '../lib/parse/teamSheet';
import type { WorkingTeams } from '../lib/parse/teams';
import type { MatchState } from '../lib/wireEnums';
import { useAction, type ActionOutcome } from '../state/useAction';

export interface MatchActionsPanelProps {
  readonly state: MatchState;
  /** Where the match is, for the cancel dialog's title. */
  readonly location: string;
  /** The locked teams, once there are some; needed to start. */
  readonly sheet: TeamSheet | null;
  readonly getWorkingTeams: (signal: AbortSignal) => Promise<CallResult<WorkingTeams>>;
  readonly start: (signal: AbortSignal) => Promise<CallResult<void>>;
  readonly cancel: (signal: AbortSignal) => Promise<CallResult<void>>;
  /** Called after a start or cancel settles, so the screen can re-read. */
  readonly onSettled: () => void;
}

function failureMessage(outcome: ActionOutcome<unknown> | null): string | null {
  if (outcome === null || outcome.kind === 'success') return null;
  return outcome.kind === 'rejected' ? REJECTION_MESSAGES[outcome.reason] : GENERIC_MATCHES_FAILURE;
}

export function MatchActionsPanel({
  state,
  location,
  sheet,
  getWorkingTeams,
  start,
  cancel,
  onSettled,
}: MatchActionsPanelProps): ReactElement | null {
  const headingId = `${useId()}-heading`;
  const starting = useAction<void>();
  const cancelling = useAction<void>();
  // The sheet a start was refused against; a re-lock brings a new sheet, which
  // clears the statement without a further activation.
  const [refusedFor, setRefusedFor] = useState<TeamSheet | null>(null);
  const unlocked = refusedFor !== null && refusedFor === sheet;
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const startable = canStart(state) && sheet !== null;
  const cancellable = canCancel(state);
  if (!startable && !cancellable) return null;

  // A start that was issued re-reads the screen whatever its outcome; one
  // stopped for unlocked changes leaves the screen as it is, with the reason.
  const handleStart = async (): Promise<void> => {
    if (sheet === null || starting.busy) return;
    setRefusedFor(null);
    let stoppedForChanges = false;
    const outcome = await starting.run(async (signal) => {
      const working = await getWorkingTeams(signal);
      if (working.kind !== 'success') return working;
      if (!workingTeamsAreLocked(sheet, working.value)) {
        stoppedForChanges = true;
        return { kind: 'success', value: undefined };
      }
      return start(signal);
    });
    if (outcome === null) return;
    if (stoppedForChanges) {
      setRefusedFor(sheet);
      return;
    }
    onSettled();
  };

  const handleCancel = async (): Promise<void> => {
    if (cancelling.busy) return;
    const outcome = await cancelling.run(cancel);
    setConfirmingCancel(false);
    if (outcome !== null) onSettled();
  };

  const failure = failureMessage(starting.outcome) ?? failureMessage(cancelling.outcome);

  return (
    <section className="matches-panel" aria-labelledby={headingId}>
      <h2 id={headingId} className="matches-subheading">
        {MATCH_ACTIONS_HEADING}
      </h2>
      {startable ? <p className="matches-hint">{START_HINT}</p> : null}
      <div className="matches-footer matches-footer--plain">
        {startable ? (
          <Button
            type="button"
            size="lg"
            icon="whistle"
            aria-disabled={starting.busy ? true : undefined}
            onClick={() => void handleStart()}
          >
            {starting.busy ? STARTING_LABEL : START_MATCH_LABEL}
          </Button>
        ) : (
          <span />
        )}
        {cancellable ? (
          <Button type="button" variant="ghost" icon="x" onClick={() => setConfirmingCancel(true)}>
            {CANCEL_MATCH_LABEL}
          </Button>
        ) : null}
      </div>
      {unlocked ? <Banner tone="error">{UNLOCKED_CHANGES_STATEMENT}</Banner> : null}
      {failure === null ? null : <Banner tone="error">{failure}</Banner>}
      {cancellable ? (
        <Dialog
          open={confirmingCancel}
          title={cancelDialogTitle(location)}
          icon="x"
          tone="danger"
          onClose={() => setConfirmingCancel(false)}
          actions={
            <>
              <Button variant="ghost" onClick={() => setConfirmingCancel(false)}>
                {KEEP_MATCH_LABEL}
              </Button>
              <Button
                variant="destructive"
                aria-disabled={cancelling.busy ? true : undefined}
                onClick={() => void handleCancel()}
              >
                {cancelling.busy ? CANCELLING_LABEL : CONFIRM_CANCEL_LABEL}
              </Button>
            </>
          }
        >
          <p className="pm-dialog__body">{CANCEL_DIALOG_BODY}</p>
        </Dialog>
      ) : null}
    </section>
  );
}

export default MatchActionsPanel;
