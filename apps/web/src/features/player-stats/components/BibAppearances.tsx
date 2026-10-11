/**
 * The Player_Stats_Screen's bib-appearances figure — how many of this squad's
 * matches this membership has spent in bibs.
 *
 * The fun one, and deliberately given the same presentation as the serious
 * figures: a label, and the whole number exactly as parsed (Requirement 9.4).
 *
 * ### It renders for every profile, because there is nothing to gate on
 *
 * Requirement 9.5 asks for the Bib_Appearance_Count to be rendered for *every*
 * Player_Profile, including one whose Appearance_Count is zero. The Appearance
 * _Count is therefore **not a prop of this component**: there is no value here to
 * branch on, so "renders for every profile" is a property of the component's
 * shape rather than a condition someone has to remember not to add. A player who
 * has played nothing shows a bib count of zero, which is the truth — they have
 * worn bibs no times — and the statement explaining why every figure on the
 * screen is zero belongs to the Record_Panel, once, rather than being repeated
 * beside each figure.
 *
 * Nor is a zero dressed up. Unlike a streak, where Requirement 9.3 asks for an
 * explanatory statement beside the value, a zero bib count needs no gloss: it is
 * a count of matches, the count is zero, and "never been put in bibs" is exactly
 * what a reader takes from it.
 *
 * ### What it does not do
 *
 * It renders **no heading** — the screen wraps this figure in a `StatSection`,
 * which contributes the one level-two heading the section owes, and a heading
 * here would either duplicate that or skip a level (Requirements 16.1, 16.2).
 * It renders **no control**, formats nothing itself (the figure passes through
 * `formatCount` from `lib/numberFormat.ts`, so the digits are determined solely
 * by the parsed value), and holds no copy — the label comes from
 * `lib/messages.ts`.
 *
 * Requirements: 9.4, 9.5
 */
import { type ReactElement } from 'react';

import { BIB_APPEARANCES_LABEL } from '../lib/messages';
import { formatCount } from '../lib/numberFormat';
import '../styles/playerStatsTokens.css';
import './BibAppearances.css';

/** The selector of the figure, so a test can assert over its whole subtree. */
export const BIB_APPEARANCES_SELECTOR = '[data-player-stats-bibs="true"]';

/** The selector of the figure's value, so a test can read it on its own. */
export const BIB_APPEARANCES_VALUE_SELECTOR = '[data-player-stats-bib-count]';

export interface BibAppearancesProps {
  /**
   * The Player_Profile's Bib_Appearance_Count, exactly as parsed
   * (Requirement 9.4).
   *
   * The only prop. There is deliberately no Appearance_Count and no flag beside
   * it, because Requirement 9.5 admits no profile for which this figure is
   * withheld.
   */
  readonly bibAppearances: number;
}

/**
 * Render the bib-appearance count with its label.
 *
 * A description list of one pair, matching the streak panel beside it, so the
 * figure is associated with its label in the markup rather than only by
 * proximity — and so the two sit alike on the page.
 *
 * Requirements: 9.4, 9.5
 */
export function BibAppearances({
  bibAppearances,
}: BibAppearancesProps): ReactElement {
  return (
    <dl className="player-stats-bibs" data-player-stats-bibs="true">
      {/* 9.4: the words naming the figure as bib appearances. */}
      <dt className="player-stats-bibs__label">{BIB_APPEARANCES_LABEL}</dt>
      {/* 9.4, 9.5: the whole number exactly as parsed, for every profile. */}
      <dd className="player-stats-bibs__value" data-player-stats-bib-count="true">
        {formatCount(bibAppearances)}
      </dd>
    </dl>
  );
}

export default BibAppearances;
