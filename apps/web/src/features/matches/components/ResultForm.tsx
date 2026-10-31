/**
 * The organiser's score entry for a match in progress: one goals counter per
 * locked team, saved as a basic result. It can be saved again to correct the
 * score until the match is completed.
 *
 * Each counter is a field with a button either side to take a goal off or add
 * one, so the score can be typed or tapped. Every field must hold a whole
 * number from 0 to 99 before anything is sent, and a field the person has to
 * fix is marked invalid and described by the message. With two teams the
 * score is also said in words: who wins, or a draw.
 */
import { useId, useState, type FormEvent, type ReactElement } from 'react';

import { Banner, Button, IconButton } from '../../../ui';

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
  addGoalLabel,
  removeGoalLabel,
  scoreLabel,
  scoreOutcomeStatement,
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

const MAX_SCORE = 99;

function initialScores(sheet: TeamSheet, result: RecordedResult | null): Record<string, string> {
  const recorded = new Map(result?.teamScores.map(({ teamId, score }) => [teamId, score]));
  return Object.fromEntries(
    sheet.teams.map(({ teamId }) => [teamId, recorded.has(teamId) ? String(recorded.get(teamId)) : '']),
  );
}

/** The field's value moved by one goal, starting from 0 when it doesn't hold a valid score yet. */
function stepped(value: string, by: 1 | -1): string {
  const read = parseScoreInput(value);
  const current = read.ok ? read.value : 0;
  return String(Math.min(MAX_SCORE, Math.max(0, current + by)));
}

export function ResultForm({ sheet, recordedResult, record, onSettled }: ResultFormProps): ReactElement {
  const idPrefix = useId();
  const headingId = `${idPrefix}-heading`;
  const problemId = `${idPrefix}-problem`;
  const [scores, setScores] = useState(() => initialScores(sheet, recordedResult));
  const [invalid, setInvalid] = useState<readonly string[]>([]);
  const action = useAction<void>();

  const setScore = (teamId: string, value: string): void =>
    setScores((current) => ({ ...current, [teamId]: value }));

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (action.busy) return;

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

  // The score in words, once both of two teams hold a valid score.
  const read = sheet.teams.map(({ teamId, teamName }) => ({ name: teamName, score: parseScoreInput(scores[teamId] ?? '') }));
  const outcomeStatement =
    read.length === 2 && read.every((team) => team.score.ok)
      ? scoreOutcomeStatement(read.map((team) => ({ name: team.name, score: team.score.ok ? team.score.value : 0 })))
      : null;

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
      <form className="matches-result-form" noValidate onSubmit={(event) => void handleSubmit(event)}>
        <p className="matches-hint">{RESULT_FORM_HINT}</p>
        <ul className="matches-score-fields">
          {sheet.teams.map(({ teamId, teamName, bibFlag }) => {
            const fieldId = `${idPrefix}-${teamId}`;
            const isInvalid = invalid.includes(teamId);
            const label = scoreLabel(teamName, bibFlag);
            return (
              <li key={teamId} className="matches-score-field">
                <label htmlFor={fieldId} className="matches-score-field__name">
                  {teamName}
                  <span className="pm-sr">{label.slice(teamName.length)}</span>
                </label>
                <div className="matches-stepper">
                  <IconButton
                    icon="minus"
                    variant="filled"
                    label={removeGoalLabel(teamName)}
                    onClick={() => setScore(teamId, stepped(scores[teamId] ?? '', -1))}
                  />
                  <input
                    id={fieldId}
                    className="matches-input matches-input--score pm-num"
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={2}
                    value={scores[teamId] ?? ''}
                    aria-invalid={isInvalid ? true : undefined}
                    aria-describedby={isInvalid ? problemId : undefined}
                    onChange={(event) => setScore(teamId, event.target.value)}
                  />
                  <IconButton
                    icon="plus"
                    variant="accent"
                    label={addGoalLabel(teamName)}
                    onClick={() => setScore(teamId, stepped(scores[teamId] ?? '', 1))}
                  />
                </div>
              </li>
            );
          })}
        </ul>
        {outcomeStatement === null ? null : (
          <Banner tone="info" announce={false}>
            {outcomeStatement}
          </Banner>
        )}
        <div className="matches-actions matches-actions--end">
          <Button type="submit" variant="secondary" aria-disabled={action.busy ? true : undefined}>
            {action.busy ? SAVING_RESULT_LABEL : SAVE_RESULT_LABEL}
          </Button>
        </div>
      </form>
      {invalid.length > 0 ? (
        <p id={problemId} className="matches-error" role="alert">
          {SCORE_INPUT_PROBLEM}
        </p>
      ) : null}
      {outcome?.kind === 'success' ? <Banner tone="success">{RESULT_SAVED_STATEMENT}</Banner> : null}
      {failure === null ? null : <Banner tone="error">{failure}</Banner>}
    </section>
  );
}

export default ResultForm;
