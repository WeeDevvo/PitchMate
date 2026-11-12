/**
 * The organiser's last step: complete a match in progress once its score is
 * saved. Completion makes the score final and applies the rating update once,
 * so it cannot be undone and asks again in a dialog that names the score. A
 * match someone else completed meanwhile reads the same as one completed here.
 */
import { useId, useState, type ReactElement } from 'react';

import { Banner, Button, Dialog } from '../../../ui';

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
  completeDialogBody,
  completeDialogTitle,
  scoreText,
} from '../lib/messages';
import type { RecordedResult } from '../lib/parse/matchDetail';
import type { TeamSheet } from '../lib/parse/teamSheet';
import type { MatchState } from '../lib/wireEnums';
import { useAction } from '../state/useAction';

export interface CompletePanelProps {
  readonly state: MatchState;
  readonly recordedResult: RecordedResult | null;
  /** The locked teams, for the score in sheet order and the player count. */
  readonly sheet: TeamSheet;
  readonly complete: (signal: AbortSignal) => Promise<CallResult<void>>;
  /** Called after a completion settles, so the screen can re-read. */
  readonly onSettled: () => void;
}

export function CompletePanel({
  state,
  recordedResult,
  sheet,
  complete,
  onSettled,
}: CompletePanelProps): ReactElement {
  const headingId = `${useId()}-heading`;
  const [confirming, setConfirming] = useState(false);
  const action = useAction<void>();
  const ready = canComplete(state, recordedResult);

  const scores = new Map(recordedResult?.teamScores.map(({ teamId, score }) => [teamId, score]));
  const score = scoreText(sheet.teams.map(({ teamId }) => scores.get(teamId) ?? 0));
  const playerCount = sheet.teams.reduce((sum, team) => sum + team.roster.length, 0);

  const handleComplete = async (): Promise<void> => {
    if (action.busy) return;
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
      {ready ? (
        <div className="matches-actions">
          <Button type="button" icon="flag" onClick={() => setConfirming(true)}>
            {COMPLETE_MATCH_LABEL}
          </Button>
        </div>
      ) : null}
      {failure === null ? null : <Banner tone="error">{failure}</Banner>}
      {ready ? (
        <Dialog
          open={confirming}
          title={completeDialogTitle(score)}
          icon="flag"
          onClose={() => setConfirming(false)}
          actions={
            <>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                {NOT_YET_LABEL}
              </Button>
              <Button
                icon="flag"
                aria-disabled={action.busy ? true : undefined}
                onClick={() => void handleComplete()}
              >
                {action.busy ? COMPLETING_LABEL : CONFIRM_COMPLETE_LABEL}
              </Button>
            </>
          }
        >
          <p className="pm-dialog__body">{completeDialogBody(playerCount)}</p>
        </Dialog>
      ) : null}
    </section>
  );
}

export default CompletePanel;
