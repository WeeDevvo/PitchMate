/**
 * The Progression_Table: every plotted value of the Progression_Series, in text.
 *
 * This is the **content** of the progression section, and the
 * Progression_Chart beside it is the illustration. Requirement 8.4 asks for each
 * Progression_Point's completion instant and Display_Rating to be conveyed in
 * text "without reference to the Progression_Chart", and Requirement 8.5 asks
 * for the same information never to be announced twice — so the chart is hidden
 * from assistive technology and this table is what a screen reader reads.
 *
 * ### A real table, with real headers
 *
 * A `table` with a `thead`, a `th scope="col"` per column, and a
 * `th scope="row"` carrying each row's date. Not a list of sentences, and not a
 * grid of `div`s: the association between a figure and the column it belongs to
 * is what lets a person using a screen reader move down the rating column and
 * hear each value with its header, and that association exists only if the
 * markup is a table. The date is the row's header because it is what identifies
 * the row — a rating alone says nothing about when it was recorded.
 *
 * The table is **visible**, not visually hidden. A hidden accessible copy would
 * mean sighted readers get the chart's approximation while everyone else gets
 * the figures, and it is the figures that are exact. One table, rendered once,
 * announced once.
 *
 * ### Every figure comes from a `lib/` formatter
 *
 * The instant passes through `formatInstantDate`, a settled Display_Rating
 * through `formatCount`, and a provisional estimate through `formatRatingBand`,
 * so a still-settling rating is only ever stated as the design system's "~"
 * band. Both render through the design system's `Rating`. Neither is formatted here, which is what makes Requirement
 * 8.9's determinism — "the same Progression_Series renders identically on two
 * loads" — a property of a tested pure function rather than of this markup:
 * `formatInstantDate` reads UTC calendar fields and a literal month table and
 * invokes no locale-dependent formatter, and `formatCount` renders the digits as
 * parsed with no grouping separator and no rounding. This component performs no
 * arithmetic on a Display_Rating beyond selecting it for presentation
 * (Requirement 7.8).
 *
 * ### An empty series is stated in words
 *
 * Where the series carries no point, the section renders
 * {@link NO_RATING_HISTORY} and no table at all (Requirement 8.6) — an empty
 * table with its headers in place reads as a history that exists and happens to
 * be blank. The chart renders nothing in the same condition, so the section is
 * one sentence.
 *
 * A long progression renders a long table. That is accepted for the MVP: the
 * figures are the point, and collapsing or paging them is a later refinement
 * that would have to keep every value announceable.
 *
 * Requirements: 8.4, 8.5, 8.6, 8.9
 */
import { type ReactElement } from 'react';
import { Rating } from '../../../ui';

import { formatInstantDate } from '../lib/instantFormat';
import { NO_RATING_HISTORY } from '../lib/messages';
import { formatCount, formatRatingBand } from '../lib/numberFormat';
import type { ProgressionPoint } from '../lib/parse/playerProfile';
import '../styles/playerStatsTokens.css';
import './ProgressionTable.css';

/** The selector of the table, so a test can assert over its whole subtree. */
export const PROGRESSION_TABLE_SELECTOR =
  '[data-player-stats-progression-table="true"]';

/** The selector of one row, so a test can read the rows in order. */
export const PROGRESSION_ROW_SELECTOR = '[data-player-stats-progression-row]';

/**
 * The column header naming when the match was completed (Requirement 8.4).
 *
 * Declared here rather than in `lib/messages.ts`, which carries
 * {@link NO_RATING_HISTORY} as the progression section's only string and no
 * column heading for either column. The two headings below are the table's own
 * notation — the words that name its axes — and are needed for the table to have
 * real headers at all; they belong in the feature's one copy module and should
 * be moved there when it is next edited, so that this is the only place in the
 * feature where a user-facing string is declared outside it.
 */
export const PROGRESSION_DATE_HEADING = 'Match completed';

/**
 * The column header naming the rating recorded for that match
 * (Requirement 8.4). See {@link PROGRESSION_DATE_HEADING} for why it is
 * declared here.
 *
 * It names the figure without restating the scope: the rating section above
 * already states that the rating is squad-scoped and exists to balance teams
 * within this squad, and the section heading names this as the progression.
 */
export const PROGRESSION_RATING_HEADING = 'Rating';

export interface ProgressionTableProps {
  /**
   * The Progression_Series, in `toProgressionSeries` order (Requirement 8.1).
   *
   * Rendered in the order given, one row per point: this component neither
   * sorts nor filters, so the table and the chart beside it describe the same
   * sequence.
   */
  readonly series: readonly ProgressionPoint[];
}

/**
 * Render the Progression_Table, or the no-history statement where the series is
 * empty.
 *
 * Requirements: 8.4, 8.5, 8.6, 8.9
 */
export function ProgressionTable({
  series,
}: ProgressionTableProps): ReactElement {
  // 8.6: a sentence rather than an empty table, and the chart renders nothing
  // beside it.
  if (series.length === 0) {
    return (
      <p className="player-stats-progression-table__empty">
        {NO_RATING_HISTORY}
      </p>
    );
  }

  return (
    <table
      className="player-stats-progression-table"
      data-player-stats-progression-table="true"
    >
      <thead>
        <tr>
          <th className="player-stats-progression-table__heading" scope="col">
            {PROGRESSION_DATE_HEADING}
          </th>
          <th className="player-stats-progression-table__heading" scope="col">
            {PROGRESSION_RATING_HEADING}
          </th>
        </tr>
      </thead>
      <tbody>
        {series.map((point, index) => (
          <tr
            // Two points can be identical in both fields — and are then
            // indistinguishable — so the index completes the key.
            key={`${String(point.completedAtMs)}:${String(point.displayRating)}:${String(point.provisional)}:${String(index)}`}
            data-player-stats-progression-row={index}
          >
            {/* The date identifies the row, so it is the row's header. */}
            <th
              className="player-stats-progression-table__date"
              scope="row"
              data-player-stats-progression-date="true"
            >
              {formatInstantDate(point.completedAtMs)}
            </th>
            <td
              className="player-stats-progression-table__rating"
              data-player-stats-progression-rating="true"
            >
              {point.provisional ? (
                <Rating provisional band={formatRatingBand(point.displayRating)} />
              ) : (
                <Rating value={formatCount(point.displayRating)} />
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default ProgressionTable;
