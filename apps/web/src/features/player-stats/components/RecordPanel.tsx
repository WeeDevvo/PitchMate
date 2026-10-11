/**
 * The record panel — a membership's Appearance_Count, its Win_Percentage, and
 * the Result_Breakdown of wins, draws, and losses.
 *
 * The first section of figures on the Player_Stats_Screen, and the one every
 * later section is read against: a rating, a streak, and a bogey opponent all
 * mean something different over four matches than over forty, so the number of
 * matches comes first.
 *
 * ### The four counts and the percentage
 *
 * | Figure | Rendered through | Absence |
 * | --- | --- | --- |
 * | Appearance_Count | `formatCount` | none — a count is never optional |
 * | wins, draws, losses | `ResultBreakdown`, via `formatCount` | none |
 * | Win_Percentage | `formatWinPercentage` | the `NO_WIN_PERCENTAGE` statement |
 *
 * Every figure goes through a `lib/` formatter, so this component contains no
 * formatting logic and the digits a person reads are covered by a property test
 * on the formatter rather than by a snapshot of this markup (Requirement 6.1).
 *
 * ### An absent percentage is a sentence, never a zero
 *
 * The panel renders `NO_WIN_PERCENTAGE` in two cases that are deliberately
 * indistinguishable on screen: the Player_Profile carried no percentage at all,
 * which is what the backend sends for a zero Appearance_Count (Requirement 6.4),
 * and `formatWinPercentage` declined a value it cannot present. Requirement 6.4
 * is explicit that **no numeric win percentage is rendered in that condition,
 * including no zero** — nobody who has played nothing has won zero per cent of
 * anything, and a figure outside the contract's range is a fault rather than a
 * percentage to be clamped into looking earned. Both read as the same sentence,
 * so neither is mistaken for a figure.
 *
 * ### A player who has played nothing still gets the whole panel
 *
 * Where the Appearance_Count is zero the panel adds the no-matches-played
 * statement **above** the figures, and goes on rendering all four counts and the
 * breakdown as the zeroes they are (Requirement 6.6). It sits first because it
 * explains the zeroes rather than commenting on them, and because the screen's
 * shape should not change with its contents — a section that vanished when empty
 * would make two profiles look like two different screens. Requirement 6.6 asks
 * the same of every later section: a no-data presentation, not an omission.
 *
 * ### Shape
 *
 * The two labelled figures are a description list, so each value is
 * programmatically associated with its own label rather than merely sitting near
 * it. The Result_Breakdown is not one of them: a win is a result rather than a
 * property of the record, and it carries its own three carriers — letter, icon,
 * and word — which a `dt` would duplicate.
 *
 * Every string comes from `lib/messages.ts`; the panel renders no heading (its
 * `StatSection` wrapper owns that) and no control.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.6, 15.5, 16.6
 */
import { type ReactElement } from 'react';

import { ResultBreakdown } from './ResultBreakdown';
import {
  APPEARANCES_LABEL,
  NO_MATCHES_PLAYED_STATEMENT,
  NO_WIN_PERCENTAGE,
  WIN_PERCENTAGE_LABEL,
} from '../lib/messages';
import { formatCount, formatWinPercentage } from '../lib/numberFormat';
import { type PlayerRecord } from '../lib/parse/playerProfile';
import '../styles/playerStatsTokens.css';
import './RecordPanel.css';

/** The selector of the panel, so a test can assert over its whole subtree. */
export const RECORD_PANEL_SELECTOR = '[data-player-stats-record="true"]';

/** The selector of one labelled figure, so a test can name the one it means. */
export const RECORD_FIGURE_SELECTOR = '[data-player-stats-figure]';

/** The figures the panel labels, and the values of `data-player-stats-figure`. */
export type RecordFigureKind = 'appearances' | 'win-percentage';

export interface RecordPanelProps {
  /** The Player_Profile's Player_Record: the four counts, every one present. */
  readonly record: PlayerRecord;

  /**
   * The Player_Profile's Win_Percentage, or `null` where it carries none
   * (Requirements 6.3, 6.4).
   */
  readonly winPercentage: number | null;
}

/**
 * Render the record: the appearance count, the win percentage, the result
 * breakdown, and — for a player who has played nothing — the statement that
 * says so.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.6, 15.5, 16.6
 */
export function RecordPanel({
  record,
  winPercentage,
}: RecordPanelProps): ReactElement {
  // 6.3, 6.4: a percentage with exactly one decimal place and an explicit
  // percentage indication, or the statement that there is none. An absent value
  // and a value the formatter declines read identically, by design.
  const formattedWinPercentage =
    winPercentage === null ? null : formatWinPercentage(winPercentage);
  const hasWinPercentage = formattedWinPercentage !== null;

  // 6.6: stated where nobody has played, and the figures below stay rendered.
  const hasNoMatches = record.appearances === 0;

  return (
    <div className="player-stats-record" data-player-stats-record="true">
      {hasNoMatches ? (
        <p className="player-stats-record__no-matches">
          {NO_MATCHES_PLAYED_STATEMENT}
        </p>
      ) : null}

      <dl className="player-stats-record__figures">
        <div
          className="player-stats-record__figure"
          data-player-stats-figure="appearances"
        >
          <dt className="player-stats-record__label">{APPEARANCES_LABEL}</dt>
          {/* 6.1: a whole number, exactly as parsed. */}
          <dd className="player-stats-record__value">
            {formatCount(record.appearances)}
          </dd>
        </div>

        <div
          className="player-stats-record__figure"
          data-player-stats-figure="win-percentage"
        >
          <dt className="player-stats-record__label">{WIN_PERCENTAGE_LABEL}</dt>
          <dd
            className={
              hasWinPercentage
                ? 'player-stats-record__value'
                : 'player-stats-record__value player-stats-record__value--absent'
            }
          >
            {formattedWinPercentage ?? NO_WIN_PERCENTAGE}
          </dd>
        </div>
      </dl>

      {/* 6.2: the three results, each a letter and an icon as well as a hue. */}
      <ResultBreakdown
        wins={record.wins}
        draws={record.draws}
        losses={record.losses}
      />
    </div>
  );
}

export default RecordPanel;
