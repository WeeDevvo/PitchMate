/**
 * The organiser's score entry for a match in progress: one goals field per
 * locked team, saved as a basic result. It can be saved again to correct the
 * score until the match is completed.
 *
 * Every field must hold a whole number from 0 to 99 before anything is sent, and
 * a field the person has to fix is marked invalid and described by the message.
 */
import { useId, useState, type FormEvent, type ReactElement } from 'react';

import { Button } from '../../../ui';

import type { CallResult, TeamScoreCommand } from '../api/matchesApi';
import { parseScoreInput } from '../lib/lifecycle';
import {
  GENERIC_MATCHES_FAILURE,
  REJECTION_MESSAGES,
  RESULT_FORM_HEADING,
  RESULT_FORM_HINT,
  RESULT_SAVED_STATEMENT,
  SAVE_RESULT_LABEL,
  SAVING_RESULT_LABEL,
  SCORE_INPUT_PROBLEM,
  scoreLabel,
} from '../lib/messages';
import type { RecordedResult } from '../lib/parse/matchDetail';
import type { TeamSheet } from '../lib/parse/teamSheet';
import { useAction } from '../state/useAction';

export interface ResultFormProps {
  readonly sheet: TeamSheet;
  readonly recordedResult: RecordedResult | null;
  readonly record: (
    teamScores: readonly TeamScoreCommand[],
    signal: AbortSignal,
  ) => Promise<CallResult<void>>;
  /** Called after a save settles, so the screen can re-read. */
  readonly onSettled: () => void;
}

function initialScores(sheet: TeamSheet, result: RecordedResult | null): Record<string, string> {
  const recorded = new Map(result?.teamScores.map(({ teamId, score }) => [teamId, score]));
  return Object.fromEntries(
    sheet.teams.map(({ teamId }) => [teamId, recorded.has(teamId) ? String(recorded.get(teamId)) : '']),
  );
}

export function ResultForm({ sheet, recordedResult, record, onSettled }: ResultFormProps): ReactElement {
  const idPrefix = useId();
  const headingId = `${idPrefix}-heading`;
  const problemId = `${idPrefix}-problem`;
  const [scores, setScores] = useState(() => initialScores(sheet, recordedResult));
  const [invalid, setInvalid] = useState<readonly string[]>([]);
  const action = useAction<void>();

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    const commands: TeamScoreCommand[] = [];
    const bad: string[] = [];
    for (const { teamId } of sheet.teams) {
      const read = parseScoreInput(scores[teamId] ?? '');
      if (read.ok) commands.push({ teamId, score: read.value });
      else bad.push(teamId);
    }

    setInvalid(bad);
    if (bad.length > 0) {
      action.reset();
      return;
    }

    const outcome = await action.run((signal) => record(commands, signal));
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
        {RESULT_FORM_HEADING}
      </h2>
      <form noValidate onSubmit={(event) => void handleSubmit(event)}>
        <p className="matches-hint">{RESULT_FORM_HINT}</p>
        <ul className="matches-score-fields">
          {sheet.teams.map(({ teamId, teamName, bibFlag }) => {
            const fieldId = `${idPrefix}-${teamId}`;
            const isInvalid = invalid.includes(teamId);
            return (
              <li key={teamId} className="matches-score-field">
                <label htmlFor={fieldId}>{scoreLabel(teamName, bibFlag)}</label>
                <input
                  id={fieldId}
                  className="matches-input matches-input--score"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={2}
                  value={scores[teamId] ?? ''}
                  aria-invalid={isInvalid ? true : undefined}
                  aria-describedby={isInvalid ? problemId : undefined}
                  onChange={(event) => setScores((current) => ({ ...current, [teamId]: event.target.value }))}
                />
              </li>
            );
          })}
        </ul>
        <div className="matches-actions">
          <Button
            type="submit"
            aria-disabled={action.busy ? true : undefined}
          >
            {action.busy ? SAVING_RESULT_LABEL : SAVE_RESULT_LABEL}
          </Button>
        </div>
      </form>
      {invalid.length > 0 ? (
        <p id={problemId} className="matches-error" role="alert">
          {SCORE_INPUT_PROBLEM}
        </p>
      ) : null}
      {outcome?.kind === 'success' ? (
        <p className="matches-notice" role="status">
          {RESULT_SAVED_STATEMENT}
        </p>
      ) : null}
      {failure === null ? null : (
        <p className="matches-error" role="alert">
          {failure}
        </p>
      )}
    </section>
  );
}

export default ResultForm;
