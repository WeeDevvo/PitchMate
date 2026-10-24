/**
 * The recorded score, for everyone in the squad: each locked team with its
 * goals and whether it won, drew or lost, in words and with an icon, never by
 * colour alone. Until the match is completed the score is marked as not yet
 * final, because an organiser can still correct it.
 */
import { useId, type ReactElement } from 'react';

import { scoreLines } from '../lib/lifecycle';
import { formatDay } from '../lib/matchDays';
import {
  COMPLETED_LABEL,
  FINAL_RESULT_LABEL,
  OUTCOME_ICONS,
  OUTCOME_LABELS,
  PROVISIONAL_RESULT_LABEL,
  RESULT_HEADING,
  RESULT_UNREADABLE_STATEMENT,
  WEARS_BIBS_BADGE,
} from '../lib/messages';
import type { RecordedResult } from '../lib/parse/matchDetail';
import type { TeamSheet } from '../lib/parse/teamSheet';

export interface ResultSummaryProps {
  readonly sheet: TeamSheet;
  readonly result: RecordedResult;
  /** When the match was completed, or `null` while the score can still change. */
  readonly completedAtMs: number | null;
}

export function ResultSummary({ sheet, result, completedAtMs }: ResultSummaryProps): ReactElement {
  const headingId = `${useId()}-heading`;
  const lines = scoreLines(sheet, result);
  const final = completedAtMs !== null;

  return (
    <section className="matches-panel matches-result" aria-labelledby={headingId}>
      <h2 id={headingId} className="matches-subheading">
        {RESULT_HEADING}
      </h2>
      <p className="matches-chip">{final ? FINAL_RESULT_LABEL : PROVISIONAL_RESULT_LABEL}</p>
      {lines === null ? (
        <p className="matches-hint">{RESULT_UNREADABLE_STATEMENT}</p>
      ) : (
        <ul className="matches-result__lines">
          {lines.map(({ teamId, teamName, bibFlag, score, outcome }) => (
            <li key={teamId} className="matches-result__line">
              <span className="matches-result__team">
                {teamName}
                {bibFlag ? <span className="matches-hint"> ({WEARS_BIBS_BADGE})</span> : null}
              </span>
              <span className="matches-result__score">{score}</span>
              <span className={`matches-result__outcome matches-result__outcome--${outcome}`}>
                <span aria-hidden="true">{OUTCOME_ICONS[outcome]}</span> {OUTCOME_LABELS[outcome]}
              </span>
            </li>
          ))}
        </ul>
      )}
      {completedAtMs === null ? null : (
        <p className="matches-hint">
          {COMPLETED_LABEL}{' '}
          <time dateTime={new Date(completedAtMs).toISOString()}>{formatDay(completedAtMs)}</time>
        </p>
      )}
    </section>
  );
}

export default ResultSummary;
