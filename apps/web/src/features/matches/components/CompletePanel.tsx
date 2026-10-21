/**
 * The organiser's last step: complete a match in progress once its score is
 * saved. Completion makes the score final and applies the rating update once,
 * so it cannot be undone and asks for a second, explicit activation. A match
 * someone else completed meanwhile reads the same as one completed here.
 */
import { useId, useState, type ReactElement } from 'react';

import type { CallResult } from '../api/matchesApi';
import { canComplete } from '../lib/lifecycle';
import {
  COMPLETE_HEADING,
  COMPLETE_HINT,
  COMPLETE_MATCH_LABEL,
  COMPLETE_NEEDS_RESULT_STATEMENT,
  COMPLETING_LABEL,
  CONFIRM_COMPLETE_LABEL,
  GENERIC_MATCHES_FAILURE,
  NOT_YET_LABEL,
  REJECTION_MESSAGES,
} from '../lib/messages';
import type { RecordedResult } from '../lib/parse/matchDetail';
import type { MatchState } from '../lib/wireEnums';
import { useAction } from '../state/useAction';

export interface CompletePanelProps {
  readonly state: MatchState;
  readonly recordedResult: RecordedResult | null;
  readonly complete: (signal: AbortSignal) => Promise<CallResult<void>>;
  /** Called after a completion settles, so the screen can re-read. */
  readonly onSettled: () => void;
}

export function CompletePanel({
  state,
  recordedResult,
  complete,
  onSettled,
}: CompletePanelProps): ReactElement {
  const headingId = `${useId()}-heading`;
  const [confirming, setConfirming] = useState(false);
  const action = useAction<void>();
  const ready = canComplete(state, recordedResult);

  const handleComplete = async (): Promise<void> => {
    const outcome = await action.run(complete);
    setConfirming(false);
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
        {COMPLETE_HEADING}
      </h2>
      <p className="matches-hint">{ready ? COMPLETE_HINT : COMPLETE_NEEDS_RESULT_STATEMENT}</p>
      {ready && !confirming ? (
        <div className="matches-actions">
          <button
            type="button"
            className="matches-button matches-button--primary"
            onClick={() => setConfirming(true)}
          >
            {COMPLETE_MATCH_LABEL}
          </button>
        </div>
      ) : null}
      {ready && confirming ? (
        <div className="matches-actions" role="group" aria-label={COMPLETE_MATCH_LABEL}>
          <button
            type="button"
            className="matches-button matches-button--primary"
            aria-disabled={action.busy ? true : undefined}
            onClick={() => void handleComplete()}
          >
            {action.busy ? COMPLETING_LABEL : CONFIRM_COMPLETE_LABEL}
          </button>
          <button type="button" className="matches-button" onClick={() => setConfirming(false)}>
            {NOT_YET_LABEL}
          </button>
        </div>
      ) : null}
      {failure === null ? null : (
        <p className="matches-error" role="alert">
          {failure}
        </p>
      )}
    </section>
  );
}

export default CompletePanel;
