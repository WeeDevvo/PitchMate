/**
 * The Result_Breakdown — a membership's wins, draws, and losses, each carried by
 * a letter, an icon, and a word.
 *
 * Its own component rather than three rows inside `RecordPanel`, because the
 * thing it has to get right is a *rule* rather than a layout: brand.md's "never
 * rely on colour alone" and Requirement 6.2's "a letter and an icon in addition
 * to any colour". Stated once, in one table, for all three outcomes — so a
 * fourth carrier added later, or a hue changed, cannot apply to two of them and
 * miss the third.
 *
 * ### Three carriers, and the hue is the least of them
 *
 * | Carrier | Wins | Draws | Losses | Who reads it |
 * | --- | --- | --- | --- | --- |
 * | letter | `W` | `D` | `L` | anyone, in any palette |
 * | icon | `✓` | `–` | `✗` | anyone, including in greyscale |
 * | word | "Wins" | "Draws" | "Losses" | assistive technology |
 * | hue | green | amber | red | reinforcement only |
 *
 * **The letter is painted in the ordinary body text colour and the icon carries
 * the hue** (design.md → "Colour is never the cue, and colour never paints
 * text"). That division is not a stylistic preference, it is what makes the hues
 * usable at all: an icon is non-text under WCAG 1.4.11 and so owes 3:1 rather
 * than 4.5:1, and Pitch Green reaches only 2.35:1 on a light surface while Green
 * Dark reaches 4.07:1 — so neither can legally letter anything (Requirement
 * 15.5). The amber is the same story in the other theme, which is why the light
 * table substitutes `#8a5a00` for a draw. The letter says which outcome it is;
 * the hue only agrees with it.
 *
 * ### Why the letter is hidden from assistive technology and a word is not
 *
 * A screen reader announcing "W 5" is announcing a letter, not a statistic. So
 * the letter and the icon are both `aria-hidden` and a plain word sits beside
 * them, present in the accessibility tree and clipped from view — the same
 * mechanism the App_Shell's announcement surface uses. The visible rendering is
 * `✓ W 5`; the announced rendering is "Wins 5". Both carry the statistic as
 * text, which is the whole of Requirement 16.6, and neither depends on the other.
 *
 * The three figures are rendered through `formatCount`, so the digits are the
 * parsed value's own and no locale-dependent formatter is involved
 * (Requirement 6.1).
 *
 * ### What it is not
 *
 * It renders no Appearance_Count — that is the panel's, because an appearance is
 * not a result — and no Win_Percentage, no heading, no no-data statement, and no
 * control. It is handed three numbers and renders them; every decision about
 * what those numbers mean has already been made.
 *
 * Requirements: 6.1, 6.2, 15.5, 16.6
 */
import { type ReactElement } from 'react';

import { DRAWS_LABEL, LOSSES_LABEL, WINS_LABEL } from '../lib/messages';
import { formatCount } from '../lib/numberFormat';
import '../styles/playerStatsTokens.css';
import './ResultBreakdown.css';

/** The selector of the breakdown, so a test can assert over its whole subtree. */
export const RESULT_BREAKDOWN_SELECTOR =
  '[data-player-stats-result-breakdown="true"]';

/** The selector of one outcome, so a test can read the three in order. */
export const RESULT_BREAKDOWN_ITEM_SELECTOR = '[data-player-stats-result]';

/**
 * The three outcomes, which are also the values of the
 * `data-player-stats-result` attribute — so a test can name the outcome it means
 * rather than matching on a letter or a hue.
 */
export type ResultOutcomeKind = 'win' | 'draw' | 'loss';

/** One outcome's four carriers, declared together so none can be forgotten. */
interface ResultOutcome {
  readonly kind: ResultOutcomeKind;
  /** The visible letter, painted in the body text colour. */
  readonly letter: string;
  /** The visible icon glyph, which carries the semantic hue. */
  readonly icon: string;
  /** The word announced in place of the letter. */
  readonly label: string;
}

/**
 * The three outcomes in the order a football table reads them: won, drawn, lost.
 *
 * The glyphs are brand.md's own — `✓`, `–`, `✗` — and are text glyphs rather
 * than an icon font or an inline image, so they scale with the surrounding type,
 * survive a forced-colours mode, and need no asset to load before the breakdown
 * is readable.
 */
const RESULT_OUTCOMES: readonly ResultOutcome[] = [
  { kind: 'win', letter: 'W', icon: '✓', label: WINS_LABEL },
  { kind: 'draw', letter: 'D', icon: '–', label: DRAWS_LABEL },
  { kind: 'loss', letter: 'L', icon: '✗', label: LOSSES_LABEL },
];

export interface ResultBreakdownProps {
  /** The Player_Record's win count, rendered exactly as parsed. */
  readonly wins: number;

  /** The Player_Record's draw count, rendered exactly as parsed. */
  readonly draws: number;

  /** The Player_Record's loss count, rendered exactly as parsed. */
  readonly losses: number;
}

/**
 * Render the three outcomes, each as a letter, an icon, a word, and a count.
 *
 * `role="list"` is stated explicitly because `ResultBreakdown.css` removes the
 * markers, and WebKit drops list semantics from a list styled that way — the
 * same reason the squads feature's `PlayerList` states it.
 *
 * Requirements: 6.1, 6.2, 15.5, 16.6
 */
export function ResultBreakdown({
  wins,
  draws,
  losses,
}: ResultBreakdownProps): ReactElement {
  const counts: Record<ResultOutcomeKind, number> = {
    win: wins,
    draw: draws,
    loss: losses,
  };

  return (
    <ul
      className="player-stats-result-breakdown"
      role="list"
      data-player-stats-result-breakdown="true"
    >
      {RESULT_OUTCOMES.map((outcome) => (
        <li
          key={outcome.kind}
          className={`player-stats-result-breakdown__item player-stats-result-breakdown__item--${outcome.kind}`}
          data-player-stats-result={outcome.kind}
        >
          {/* 6.2, 15.5: the hue lives here, on a non-text mark owing 3:1, and
              never on the letter beside it. */}
          <span className="player-stats-result-breakdown__icon" aria-hidden="true">
            {outcome.icon}
          </span>

          {/* 6.2: the letter, in the ordinary body text colour. Hidden from the
              accessibility tree in favour of the word below it, which says the
              same thing in full. */}
          <span className="player-stats-result-breakdown__letter" aria-hidden="true">
            {outcome.letter}
          </span>

          {/* 16.6: the announced name of the statistic — present to assistive
              technology, clipped from view. */}
          <span className="player-stats-result-breakdown__name">
            {outcome.label}
          </span>

          {/* 6.1: the count, exactly as parsed. */}
          <span className="player-stats-result-breakdown__count">
            {formatCount(counts[outcome.kind])}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default ResultBreakdown;
